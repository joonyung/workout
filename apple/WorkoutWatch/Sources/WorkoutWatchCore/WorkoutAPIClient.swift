import Foundation

public enum WorkoutAPIError: LocalizedError, Equatable {
    case invalidConfiguration
    case invalidResponse
    case httpStatus(Int, String)

    public var errorDescription: String? {
        switch self {
        case .invalidConfiguration:
            "서버 설정을 확인하세요."
        case .invalidResponse:
            "서버 응답을 읽을 수 없습니다."
        case let .httpStatus(status, message):
            "서버 오류 \(status): \(message)"
        }
    }
}

public actor WorkoutAPIClient {
    private let credentials: ServiceCredentials
    private let urlSession: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(credentials: ServiceCredentials, urlSession: URLSession = .shared) {
        self.credentials = credentials
        self.urlSession = urlSession
        encoder = JSONEncoder()
        decoder = JSONDecoder()
    }

    public func fetchBootstrap() async throws -> WatchBootstrap {
        let request = try makeRequest(path: ["api", "watch", "bootstrap"])
        let data = try await perform(request)
        do {
            return try decoder.decode(WatchBootstrap.self, from: data)
        } catch {
            throw WorkoutAPIError.invalidResponse
        }
    }

    public func save(_ workout: WorkoutSessionRecord) async throws -> WorkoutSaveResult {
        var request = try makeRequest(path: ["api", "workouts"], method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(workout)
        let data = try await perform(request)
        do {
            return try decoder.decode(WorkoutSaveResult.self, from: data)
        } catch {
            throw WorkoutAPIError.invalidResponse
        }
    }

    private func makeRequest(path: [String], method: String = "GET") throws -> URLRequest {
        guard credentials.isComplete else { throw WorkoutAPIError.invalidConfiguration }
        let url = path.reduce(credentials.serverURL) { partial, component in
            partial.appendingPathComponent(component)
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue(credentials.clientID, forHTTPHeaderField: "CF-Access-Client-Id")
        request.setValue(credentials.clientSecret, forHTTPHeaderField: "CF-Access-Client-Secret")
        if let origin = originValue(for: credentials.serverURL) {
            request.setValue(origin, forHTTPHeaderField: "Origin")
        }
        return request
    }

    private func perform(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await urlSession.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw WorkoutAPIError.invalidResponse
        }
        guard (200..<300).contains(response.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? ""
            throw WorkoutAPIError.httpStatus(response.statusCode, message)
        }
        return data
    }

    private func originValue(for url: URL) -> String? {
        guard let scheme = url.scheme, let host = url.host else { return nil }
        if let port = url.port { return "\(scheme)://\(host):\(port)" }
        return "\(scheme)://\(host)"
    }
}
