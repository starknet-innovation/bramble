// Dev-only: puts a simulator screenshot inside Xcode's own outline of the device.
// Usage: swift frame.swift "<device type, e.g. iPhone 17>" <shot.png> <out.png>
// Take the shot with `simctl io <udid> screenshot --mask=alpha` so the screen's corners match.
import AppKit

func find(_ key: String, in node: Any) -> Any? {
    if let dict = node as? [String: Any] {
        return dict[key] ?? dict.values.lazy.compactMap { find(key, in: $0) }.first
    }
    return (node as? [Any])?.lazy.compactMap { find(key, in: $0) }.first
}

let args = CommandLine.arguments
let profile = "/Library/Developer/CoreSimulator/Profiles/DeviceTypes/\(args[1]).simdevicetype/Contents/Resources"
let plist = NSDictionary(contentsOfFile: "\(profile)/profile.plist") as! [String: Any]
let caps = NSDictionary(contentsOfFile: "\(profile)/capabilities.plist") as! [String: Any]
let chrome = (plist["chromeIdentifier"] as! String).split(separator: ".").last!
let frame = CGPDFDocument(URL(fileURLWithPath:
    "/Library/Developer/DeviceKit/Chrome/\(chrome).devicechrome/Contents/Resources/PhoneComposite.pdf") as CFURL)!
    .page(at: 1)!
let shot = NSImage(contentsOfFile: args[2])!.cgImage(forProposedRect: nil, context: nil, hints: nil)!

// The outline is drawn in points; the screenshot is in pixels.
let scale = CGFloat((find("main-screen-scale", in: caps) as? NSNumber)?.doubleValue ?? 3)
let outline = frame.getBoxRect(.mediaBox)
let screen = CGSize(width: CGFloat(shot.width) / scale, height: CGFloat(shot.height) / scale)
let ctx = CGContext(data: nil, width: Int(outline.width * scale), height: Int(outline.height * scale),
                    bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.scaleBy(x: scale, y: scale)
ctx.drawPDFPage(frame)
// ponytail: centres the screen in the outline; right for phones, check by eye on an asymmetric one.
ctx.draw(shot, in: CGRect(origin: CGPoint(x: (outline.width - screen.width) / 2,
                                          y: (outline.height - screen.height) / 2), size: screen))
try NSBitmapImageRep(cgImage: ctx.makeImage()!).representation(using: .png, properties: [:])!
    .write(to: URL(fileURLWithPath: args[3]))
