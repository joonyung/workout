import SwiftUI
import WorkoutWatchCore

struct ConfigurationView: View {
    @ObservedObject var bridge: WatchConfigurationBridge
    @State private var serverURL = "https://workout.joonyung.work"
    @State private var clientID = ""
    @State private var clientSecret = ""
    @State private var feedback = ""
    @State private var testing = false

    private let credentialsStore = CredentialsStore(
        service: "com.joonyung.workout.ios.credentials"
    )

    var body: some View {
        NavigationStack {
            Form {
                Section("서버") {
                    TextField("서버 URL", text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                }

                Section("Cloudflare Access 서비스 토큰") {
                    TextField("Client ID", text: $clientID)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Client Secret", text: $clientSecret)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Text("값은 Git이나 UserDefaults가 아니라 각 기기의 Keychain에만 저장됩니다.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Button("저장하고 워치로 보내기") { saveAndSend() }
                        .disabled(credentials == nil)
                    Button(testing ? "연결 확인 중…" : "서버 연결 확인") { testConnection() }
                        .disabled(testing || credentials == nil)
                }

                Section("상태") {
                    Text(feedback.isEmpty ? bridge.status : feedback)
                        .foregroundStyle(feedback.hasPrefix("연결 성공") ? Color.green : Color.secondary)
                }

                Section("최초 설정") {
                    Text("Cloudflare Zero Trust에서 이 앱 전용 Service Token을 만든 뒤, workout.joonyung.work Access 정책에 Service Auth 허용 규칙을 추가하세요. 발급된 두 값을 위에 한 번만 입력하면 됩니다.")
                        .font(.footnote)
                }
            }
            .navigationTitle("Workout Watch")
            .onAppear(perform: loadSavedCredentials)
        }
    }

    private var credentials: ServiceCredentials? {
        guard let url = URL(string: serverURL.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return nil
        }
        let value = ServiceCredentials(
            serverURL: url,
            clientID: clientID.trimmingCharacters(in: .whitespacesAndNewlines),
            clientSecret: clientSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        return value.isComplete ? value : nil
    }

    private func loadSavedCredentials() {
        guard let saved = try? credentialsStore.load() else { return }
        serverURL = saved.serverURL.absoluteString
        clientID = saved.clientID
        clientSecret = saved.clientSecret
    }

    private func saveAndSend() {
        guard let credentials else { return }
        do {
            try credentialsStore.save(credentials)
            try bridge.send(credentials)
            feedback = "저장 완료"
        } catch {
            feedback = "저장 실패: \(error.localizedDescription)"
        }
    }

    private func testConnection() {
        guard let credentials else { return }
        testing = true
        feedback = ""
        Task {
            do {
                let bootstrap = try await WorkoutAPIClient(credentials: credentials).fetchBootstrap()
                let title = bootstrap.plan?.title ?? "현재 계획 없음"
                await MainActor.run {
                    feedback = "연결 성공 · \(title)"
                    testing = false
                }
            } catch {
                await MainActor.run {
                    feedback = "연결 실패: \(error.localizedDescription)"
                    testing = false
                }
            }
        }
    }
}
