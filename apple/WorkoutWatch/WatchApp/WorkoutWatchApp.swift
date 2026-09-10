import SwiftUI

@main
struct WorkoutWatchApp: App {
    @StateObject private var model = WatchWorkoutModel()
    private let configurationReceiver = WatchConfigurationReceiver()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .onReceive(NotificationCenter.default.publisher(for: .workoutCredentialsChanged)) { _ in
                    model.configurationChanged()
                }
                .task { model.refresh() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.refresh() }
        }
    }
}
