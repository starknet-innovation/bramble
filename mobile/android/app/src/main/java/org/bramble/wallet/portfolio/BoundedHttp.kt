package org.bramble.wallet.portfolio

import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.bramble.core.HttpMethod
import org.bramble.core.HttpOutcome
import org.bramble.core.HttpRequest

/** Moves the bytes of one exchange the Rust core described; the core judges every response. */
fun interface PortfolioTransport {
    suspend fun perform(request: HttpRequest): HttpOutcome
}

/**
 * The Android counterpart of iOS `BoundedHttp` (UNCOMPILED: no Android SDK on the authoring
 * machine). HTTPS only, redirects refused, no cookies or cache, a declared `Content-Length` over
 * budget refused before reading, the streamed body cut off past `maxBodyBytes` (a truncated body is
 * never passed on), and one deadline over the whole exchange.
 */
object BoundedHttp : PortfolioTransport {
    private fun unanswered(timedOut: Boolean = false) = HttpOutcome(0u, null, null, timedOut)

    override suspend fun perform(request: HttpRequest): HttpOutcome {
        val url = runCatching { URL(request.url) }.getOrNull() ?: return unanswered()
        if (url.protocol != "https") return unanswered()
        return withTimeoutOrNull(request.deadlineMs.toLong()) {
            withContext(Dispatchers.IO) { read(url, request) }
        } ?: unanswered(timedOut = true)
    }

    private fun read(url: URL, request: HttpRequest): HttpOutcome {
        val connection = url.openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.connectTimeout = request.deadlineMs.toInt()
            connection.readTimeout = request.deadlineMs.toInt()
            connection.requestMethod = if (request.method == HttpMethod.POST) "POST" else "GET"
            request.headers.forEach { connection.setRequestProperty(it.name, it.value) }
            request.body?.let { body ->
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toByteArray()) }
            }
            val status = connection.responseCode
            val retryAfter = connection.getHeaderField("Retry-After")
            val refused = HttpOutcome(status.toUShort(), retryAfter, null, false)
            val declared = connection.getHeaderField("Content-Length")
            if (declared != null && (!declared.all { it in '0'..'9' } || (declared.toBigIntegerOrNull()?.toLong() ?: Long.MAX_VALUE) > request.maxBodyBytes.toLong())) {
                return refused
            }
            val stream = (if (status >= 400) connection.errorStream else connection.inputStream) ?: return HttpOutcome(status.toUShort(), retryAfter, ByteArray(0), false)
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            stream.use {
                while (true) {
                    val read = it.read(buffer)
                    if (read < 0) break
                    out.write(buffer, 0, read)
                    if (out.size().toLong() > request.maxBodyBytes.toLong()) return refused
                }
            }
            return HttpOutcome(status.toUShort(), retryAfter, out.toByteArray(), false)
        } catch (error: Exception) {
            return unanswered()
        } finally {
            connection.disconnect()
        }
    }
}
