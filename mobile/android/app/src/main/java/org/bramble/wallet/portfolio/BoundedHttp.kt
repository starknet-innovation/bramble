package org.bramble.wallet.portfolio

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.bramble.core.HttpMethod
import org.bramble.core.HttpOutcome
import org.bramble.core.HttpRequest
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/** Moves the bytes of one exchange the Rust core described; the core judges every response. */
fun interface PortfolioTransport {
    /**
     * Performs [request] and reports what came back. Implementations never throw for a transport
     * failure: an unreachable host, a refused scheme, or a timeout is an unanswered outcome.
     */
    suspend fun perform(request: HttpRequest): HttpOutcome
}

/** Status codes from here up carry their body on the error stream. */
private const val HTTP_ERROR_MIN = 400

/** The streamed read's chunk size. */
private const val READ_CHUNK_BYTES = 8192

/**
 * The Android counterpart of iOS `BoundedHttp`. HTTPS only, redirects refused, no cookies or
 * cache, a declared `Content-Length` over budget refused before reading, the streamed body cut off
 * past `maxBodyBytes` (a truncated body is never passed on), and one deadline over the whole
 * exchange.
 */
object BoundedHttp : PortfolioTransport {
    private fun unanswered(timedOut: Boolean = false) = HttpOutcome(0u, null, null, timedOut)

    override suspend fun perform(request: HttpRequest): HttpOutcome {
        val url =
            runCatching { URL(request.url) }.getOrNull()?.takeIf { it.protocol == "https" }
                ?: return unanswered()
        return withTimeoutOrNull(request.deadlineMs.toLong()) {
            withContext(Dispatchers.IO) { read(url, request) }
        } ?: unanswered(timedOut = true)
    }

    private fun read(
        url: URL,
        request: HttpRequest,
    ): HttpOutcome {
        val connection = url.openConnection() as HttpURLConnection
        return try {
            exchange(connection, request)
        } catch (ignored: Exception) {
            // Any transport failure is an unanswered request; the core plans the retry.
            unanswered()
        } finally {
            connection.disconnect()
        }
    }

    /** Sends [request] on [connection]; a body over budget, declared or streamed, is refused (null). */
    private fun exchange(
        connection: HttpURLConnection,
        request: HttpRequest,
    ): HttpOutcome {
        configure(connection, request)
        val status = connection.responseCode
        val retryAfter = connection.getHeaderField("Retry-After")
        val limit = request.maxBodyBytes.toLong()
        val body =
            if (declaredOverBudget(connection.getHeaderField("Content-Length"), limit)) {
                null
            } else {
                responseBody(connection, status, limit)
            }
        return HttpOutcome(status.toUShort(), retryAfter, body, false)
    }

    private fun configure(
        connection: HttpURLConnection,
        request: HttpRequest,
    ) {
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
    }

    /** A `Content-Length` that is not plain digits, or over [limit], refuses the body unread. */
    private fun declaredOverBudget(
        declared: String?,
        limit: Long,
    ): Boolean =
        declared != null &&
            (
                !declared.all { it in '0'..'9' } ||
                    (declared.toBigIntegerOrNull()?.toLong() ?: Long.MAX_VALUE) > limit
            )

    /** The body (empty when there is no stream), or null once it runs past [limit]. */
    private fun responseBody(
        connection: HttpURLConnection,
        status: Int,
        limit: Long,
    ): ByteArray? {
        val stream =
            (if (status >= HTTP_ERROR_MIN) connection.errorStream else connection.inputStream)
                ?: return ByteArray(0)
        return stream.use { readBounded(it, limit) }
    }

    private fun readBounded(
        stream: InputStream,
        limit: Long,
    ): ByteArray? {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(READ_CHUNK_BYTES)
        var read = stream.read(buffer)
        while (read >= 0) {
            out.write(buffer, 0, read)
            if (out.size().toLong() > limit) return null
            read = stream.read(buffer)
        }
        return out.toByteArray()
    }
}
