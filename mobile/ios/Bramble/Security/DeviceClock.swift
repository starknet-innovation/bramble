import BrambleCore
import Darwin

/// The core's only time source: `mach_continuous_time` (keeps counting while the device sleeps,
/// cannot be set from Settings) and the kernel's per-boot session UUID. There is deliberately no
/// wall clock here, so changing the date cannot shorten a backoff delay or extend a session.
final class DeviceClock: HostClock {
    /// Nanoseconds per millisecond, for the monotonic reading.
    private static let nanosecondsPerMillisecond: UInt64 = 1_000_000

    private let numer: UInt64
    private let denom: UInt64
    private let boot: String

    init() {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        numer = UInt64(max(info.numer, 1))
        denom = UInt64(max(info.denom, 1))
        boot = Self.readBootId()
    }

    func monotonicMs() -> UInt64 {
        let ticks = mach_continuous_time()
        // ticks × numer / denom is nanoseconds; divide first so the product cannot overflow.
        return ticks / denom * numer / Self.nanosecondsPerMillisecond
    }

    func bootId() -> String { boot }

    /// `kern.bootsessionuuid` changes on every boot. Should it be unreadable, the boot time is
    /// used instead; an empty id only makes every boot look the same, never shortens a delay
    /// within one boot.
    private static func readBootId() -> String {
        var size = 0
        if sysctlbyname("kern.bootsessionuuid", nil, &size, nil, 0) == 0, size > 1 {
            var buffer = [CChar](repeating: 0, count: size)
            if sysctlbyname("kern.bootsessionuuid", &buffer, &size, nil, 0) == 0 {
                return String(cString: buffer)
            }
        }
        var boottime = timeval()
        var length = MemoryLayout<timeval>.size
        if sysctlbyname("kern.boottime", &boottime, &length, nil, 0) == 0 {
            return "boottime-\(boottime.tv_sec)-\(boottime.tv_usec)"
        }
        return ""
    }
}
