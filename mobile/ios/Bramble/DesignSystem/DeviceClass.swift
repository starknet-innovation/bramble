import SwiftUI

/// Which of the extension's breakpoints a scene falls under. Evaluated on the full scene (safe
/// areas included), the way a CSS viewport is measured, so an iPhone 16 (390×844) takes the phone
/// rules and the base height rules exactly as its 390×844 UI Lab capture does (design-mobile.md
/// 4.7). Every iPhone is `phone`; only short scenes such as the iPhone SE are `short`.
struct DeviceClass: Equatable {
    /// `max-width: 520px`: full-bleed onboarding, no card shadow or radius.
    let phone: Bool
    /// `max-height: 760px`: the compact onboarding paddings and lockup.
    let short: Bool

    static let regularPhone = DeviceClass(phone: true, short: false)

    static func resolve(size: CGSize, insets: EdgeInsets) -> DeviceClass {
        DeviceClass(
            phone: size.width + insets.leading + insets.trailing <= BrambleBreakpoint.phoneWidth,
            short: size.height + insets.top + insets.bottom <= BrambleBreakpoint.shortHeight
        )
    }
}

private struct DeviceClassKey: EnvironmentKey {
    static let defaultValue = DeviceClass.regularPhone
}

extension EnvironmentValues {
    var deviceClass: DeviceClass {
        get { self[DeviceClassKey.self] }
        set { self[DeviceClassKey.self] = newValue }
    }
}

/// Measures the scene once at the root and publishes its class to everything below.
struct DeviceClassReader<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        GeometryReader { proxy in
            content()
                .frame(width: proxy.size.width, height: proxy.size.height)
                .environment(\.deviceClass, DeviceClass.resolve(size: proxy.size, insets: proxy.safeAreaInsets))
        }
    }
}
