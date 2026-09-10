import Foundation

@MainActor
public final class SessionCache {
    private let defaults: UserDefaults
    private let key: String
    private let pendingKey: String

    public init(
        defaults: UserDefaults = .standard,
        key: String = "workout-watch-active-session",
        pendingKey: String = "workout-watch-has-pending-changes"
    ) {
        self.defaults = defaults
        self.key = key
        self.pendingKey = pendingKey
    }

    public var hasPendingChanges: Bool { defaults.bool(forKey: pendingKey) }

    public func load() -> WorkoutSessionRecord? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WorkoutSessionRecord.self, from: data)
    }

    public func save(_ session: WorkoutSessionRecord, pending: Bool) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        defaults.set(data, forKey: key)
        defaults.set(pending, forKey: pendingKey)
    }

    public func markSynced() {
        defaults.set(false, forKey: pendingKey)
    }

    public func clear() {
        defaults.removeObject(forKey: key)
        defaults.removeObject(forKey: pendingKey)
    }
}
