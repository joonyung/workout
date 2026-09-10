import SwiftUI

@main
struct WorkoutCompanionApp: App {
    @StateObject private var bridge = WatchConfigurationBridge()

    var body: some Scene {
        WindowGroup {
            ConfigurationView(bridge: bridge)
        }
    }
}
