import Foundation
@preconcurrency import WatchConnectivity
import WorkoutWatchCore

@MainActor
final class WatchConfigurationBridge: NSObject, ObservableObject, WCSessionDelegate {
    @Published private(set) var status = "Apple Watch 연결 확인 중"

    override init() {
        super.init()
        guard WCSession.isSupported() else {
            status = "이 iPhone에서는 Apple Watch 연결을 사용할 수 없습니다."
            return
        }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func send(_ credentials: ServiceCredentials) throws {
        let data = try JSONEncoder().encode(credentials)
        try WCSession.default.updateApplicationContext(["credentials": data])
        status = WCSession.default.isWatchAppInstalled
            ? "설정을 Apple Watch로 전송했습니다."
            : "저장했습니다. 워치 앱을 설치하면 설정이 전송됩니다."
    }

    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        let nextStatus: String
        if let error {
            nextStatus = "Apple Watch 연결 실패: \(error.localizedDescription)"
        } else if session.isWatchAppInstalled {
            nextStatus = "Apple Watch가 연결되어 있습니다."
        } else {
            nextStatus = "워치 앱을 설치한 뒤 다시 저장하세요."
        }
        Task { @MainActor [weak self] in
            self?.status = nextStatus
        }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}
