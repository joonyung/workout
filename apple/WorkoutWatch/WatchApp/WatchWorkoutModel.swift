import Foundation
import SwiftUI
import UserNotifications
import WatchKit
import WorkoutWatchCore

@MainActor
final class WatchWorkoutModel: ObservableObject {
    enum SyncState: Equatable {
        case idle
        case syncing
        case synced
        case pending
    }

    @Published private(set) var plan: WorkoutPlan?
    @Published private(set) var session: WorkoutSessionRecord?
    @Published private(set) var isLoading = false
    @Published private(set) var needsSetup = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var syncState: SyncState = .idle
    @Published private(set) var restEndsAt: Date?

    private let credentialsStore = CredentialsStore()
    private let cache = SessionCache()
    private var client: WorkoutAPIClient?
    private var restTask: Task<Void, Never>?

    init() {
        session = cache.load()
        syncState = cache.hasPendingChanges ? .pending : .idle
        configureClient()
    }

    var completedSets: Int { session?.completedWorkingSets ?? 0 }
    var targetSets: Int { session?.targetWorkingSets ?? 0 }

    func configurationChanged() {
        configureClient()
        refresh()
    }

    func refresh() {
        configureClient()
        guard let client else {
            needsSetup = true
            isLoading = false
            return
        }
        needsSetup = false
        isLoading = session == nil
        errorMessage = nil
        let pendingSession = cache.hasPendingChanges ? session : nil

        Task {
            do {
                if let pendingSession {
                    let result = try await client.save(pendingSession)
                    if result.discarded != true { cache.markSynced() }
                }
                let bootstrap = try await client.fetchBootstrap()
                apply(bootstrap)
                isLoading = false
            } catch {
                isLoading = false
                errorMessage = session == nil ? error.localizedDescription : nil
                syncState = session == nil ? .idle : .pending
            }
        }
    }

    func exercise(id: String) -> SessionExercise? {
        session?.exercises.first(where: { $0.id == id })
    }

    func set(exerciseID: String, setID: String) -> SessionSet? {
        exercise(id: exerciseID)?.sets.first(where: { $0.id == setID })
    }

    func saveSet(
        exerciseID: String,
        setID: String,
        weight: Double,
        reps: Int,
        rpe: Double,
        completed: Bool
    ) {
        guard var record = session,
              let exerciseIndex = record.exercises.firstIndex(where: { $0.id == exerciseID }),
              let setIndex = record.exercises[exerciseIndex].sets.firstIndex(where: { $0.id == setID })
        else { return }

        let wasCompleted = record.exercises[exerciseIndex].sets[setIndex].isCompleted
        let unit = record.exercises[exerciseIndex].weightUnit
        record.exercises[exerciseIndex].sets[setIndex].weightKg = unit == .kg ? NumericValue(weight) : nil
        record.exercises[exerciseIndex].sets[setIndex].weightLb = unit == .lb ? NumericValue(weight) : nil
        record.exercises[exerciseIndex].sets[setIndex].reps = NumericValue(Double(reps))
        record.exercises[exerciseIndex].sets[setIndex].rpe = NumericValue(rpe)
        record.exercises[exerciseIndex].sets[setIndex].completed = completed
        record.exercises[exerciseIndex].sets[setIndex].completedAt = completed
            ? (record.exercises[exerciseIndex].sets[setIndex].completedAt ?? WorkoutClock.timestamp())
            : nil
        record.touch()
        session = record
        cache.save(record, pending: true)

        if completed && !wasCompleted {
            WKInterfaceDevice.current().play(.success)
            startRestTimer(seconds: record.exercises[exerciseIndex].restSeconds)
        }
        sync()
    }

    func saveCardio(
        id: String,
        minutes: Double,
        distanceKm: Double?,
        averageHeartRate: Double?,
        rpe: Double,
        completed: Bool
    ) {
        guard var record = session,
              let index = record.cardio?.firstIndex(where: { $0.id == id })
        else { return }
        record.cardio?[index].durationMinutes = NumericValue(minutes)
        record.cardio?[index].distanceKm = NumericValue(distanceKm)
        record.cardio?[index].averageHeartRate = NumericValue(averageHeartRate)
        record.cardio?[index].rpe = NumericValue(rpe)
        record.cardio?[index].completed = completed
        record.cardio?[index].completedAt = completed ? WorkoutClock.timestamp() : nil
        record.touch()
        session = record
        cache.save(record, pending: true)
        if completed { WKInterfaceDevice.current().play(.success) }
        sync()
    }

    func finish(sessionRpe: Double, notes: String) {
        guard var record = session else { return }
        record.sessionRpe = sessionRpe
        record.notes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        record.finishedAt = WorkoutClock.timestamp()
        record.touch()
        session = record
        cache.save(record, pending: true)
        cancelRestTimer()
        WKInterfaceDevice.current().play(.success)
        sync()
    }

    func cancelRestTimer() {
        restTask?.cancel()
        restTask = nil
        restEndsAt = nil
        UNUserNotificationCenter.current().removePendingNotificationRequests(
            withIdentifiers: ["workout-rest-timer"]
        )
    }

    private func configureClient() {
        guard let credentials = try? credentialsStore.load(), credentials.isComplete else {
            client = nil
            return
        }
        client = WorkoutAPIClient(credentials: credentials)
    }

    private func apply(_ bootstrap: WatchBootstrap) {
        plan = bootstrap.plan
        if let remote = bootstrap.session {
            session = remote
        } else if let plan = bootstrap.plan {
            if session?.planId != plan.id {
                session = WorkoutSessionFactory.makeSession(from: plan)
            }
        } else {
            session = nil
        }
        if let session {
            cache.save(session, pending: false)
        } else {
            cache.clear()
        }
        syncState = .synced
    }

    private func sync() {
        guard let client, let snapshot = session else {
            syncState = .pending
            return
        }
        syncState = .syncing
        Task {
            do {
                let result = try await client.save(snapshot)
                if result.discarded == true {
                    let bootstrap = try await client.fetchBootstrap()
                    apply(bootstrap)
                    errorMessage = "다른 기기의 최신 기록을 불러왔습니다."
                } else if session?.updatedAt == snapshot.updatedAt {
                    cache.markSynced()
                    syncState = .synced
                }
            } catch {
                syncState = .pending
            }
        }
    }

    private func startRestTimer(seconds: Int) {
        cancelRestTimer()
        let duration = max(1, seconds)
        restEndsAt = Date().addingTimeInterval(TimeInterval(duration))
        restTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(duration))
            guard !Task.isCancelled else { return }
            self?.restEndsAt = nil
            WKInterfaceDevice.current().play(.notification)
        }

        Task {
            let center = UNUserNotificationCenter.current()
            _ = try? await center.requestAuthorization(options: [.alert, .sound])
            let content = UNMutableNotificationContent()
            content.title = "휴식 종료"
            content.body = "다음 세트를 시작하세요."
            content.sound = .default
            let trigger = UNTimeIntervalNotificationTrigger(
                timeInterval: TimeInterval(duration),
                repeats: false
            )
            try? await center.add(UNNotificationRequest(
                identifier: "workout-rest-timer",
                content: content,
                trigger: trigger
            ))
        }
    }
}
