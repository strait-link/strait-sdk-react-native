import UIKit

// Prints what the no-prompt pasteboard checks return for the current clipboard.
// hasURLs = expo-clipboard hasUrlAsync / @react-native-clipboard hasURL.
// detectPatterns(.probableWebURL) = @react-native-clipboard hasWebURL / the Flutter README channel.
func probe(_ label: String, done: @escaping () -> Void) {
    let pb = UIPasteboard.general
    let hasURLs = pb.hasURLs
    let hasStrings = pb.hasStrings
    pb.detectPatterns(for: [.probableWebURL]) { r in
        let probable = (try? r.get())?.contains(.probableWebURL) ?? false
        print("PROBE \(label) types=\(pb.types) hasURLs=\(hasURLs) hasStrings=\(hasStrings) probableWebURL=\(probable)")
        done()
    }
}

class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let args = ProcessInfo.processInfo.arguments
        let label = args.count > 1 ? args[1] : "clipboard"
        if label == "url-type" {
            UIPasteboard.general.url = URL(string: "https://demo.strait.link/h/AAAAAAAAAAAAAAAAAAAAAA")
        }
        probe(label) { exit(0) }
        return true
    }
}
UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
