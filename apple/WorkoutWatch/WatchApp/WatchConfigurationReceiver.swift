import Foundation
@preconcurrency import WatchConnectivity
import WorkoutWatchCore

extension Notification.Name {
    static let workoutCredentialsChanged = Notification.Name("workoutCredentialsChanged")
}

final class WatchConfigurationReceiver: NSObject, WCSessionDelegate {
    private let credentialsStore = CredentialsStore()

    override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
        consume(WCSession.default.receivedApplicationContext)
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        consume(session.receivedApplicationContext)
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        consume(applicationContext)
    }

    private func consume(_ context: [String: Any]) {
        guard
            let data = context["credentials"] as? Data,
            let credentials = try? JSONDecoder().decode(ServiceCredentials.self, from: data),
            credentials.isComplete,
            (try? credentialsStore.save(credentials)) != nil
        else { return }
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .workoutCredentialsChanged, object: nil)
        }
    }
}
