import Foundation
import Testing
@testable import WorkoutWatchCore

@Test func numericValueDecodesNumbersAndEmptyStrings() throws {
    let decoder = JSONDecoder()
    #expect(try decoder.decode(NumericValue.self, from: Data("85".utf8)).value == 85)
    #expect(try decoder.decode(NumericValue.self, from: Data("\"22.25\"".utf8)).value == 22.25)
    #expect(try decoder.decode(NumericValue.self, from: Data("\"\"".utf8)).value == nil)
}

@Test func sessionFactoryPreservesPoundLoads() throws {
    let planJSON = """
    {
      "id": "plan-test",
      "date": "2026-09-10",
      "title": "테스트",
      "exercises": [{
        "id": "leg-extension",
        "name": "Leg Extension",
        "muscleGroup": "하체",
        "targetSets": 2,
        "repRange": [12, 15],
        "targetRpe": 8,
        "restSeconds": 90,
        "startingWeightLb": 85
      }],
      "cardio": [{
        "id": "bike",
        "name": "Bike",
        "targetMinutes": 15,
        "rpeRange": [4, 5]
      }]
    }
    """
    let plan = try JSONDecoder().decode(WorkoutPlan.self, from: Data(planJSON.utf8))
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
    let date = Date(timeIntervalSince1970: 1_789_008_000)
    let session = WorkoutSessionFactory.makeSession(from: plan, date: date, calendar: calendar)

    #expect(session.planId == plan.id)
    #expect(session.exercises[0].sets.count == 2)
    #expect(session.exercises[0].sets[0].weightLb?.value == 85)
    #expect(session.exercises[0].sets[0].weightKg == nil)
    #expect(session.cardio?[0].durationMinutes?.value == 15)
}

@Test func sessionRoundTripKeepsEmptyEntryFields() throws {
    let planJSON = """
    {
      "id": "plan-test",
      "date": "2026-09-10",
      "title": "테스트",
      "exercises": [{
        "id": "press",
        "name": "Press",
        "muscleGroup": "가슴",
        "targetSets": 1,
        "repRange": [8, 12],
        "targetRpe": 8,
        "restSeconds": 120,
        "startingWeightKg": 70
      }]
    }
    """
    let plan = try JSONDecoder().decode(WorkoutPlan.self, from: Data(planJSON.utf8))
    let session = WorkoutSessionFactory.makeSession(from: plan)
    let data = try JSONEncoder().encode(session)
    let decoded = try JSONDecoder().decode(WorkoutSessionRecord.self, from: data)

    #expect(decoded.exercises[0].sets[0].weightKg?.value == 70)
    #expect(decoded.exercises[0].sets[0].reps?.value == nil)
    #expect(decoded.exercises[0].sets[0].completed == false)
}

@MainActor
@Test func sessionCachePersistsPendingState() throws {
    let suiteName = "WorkoutWatchCoreTests-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let cache = SessionCache(defaults: defaults)
    let planJSON = """
    {
      "id": "plan-cache",
      "date": "2026-09-10",
      "title": "캐시 테스트",
      "exercises": []
    }
    """
    let plan = try JSONDecoder().decode(WorkoutPlan.self, from: Data(planJSON.utf8))
    let session = WorkoutSessionFactory.makeSession(from: plan)

    cache.save(session, pending: true)
    #expect(cache.hasPendingChanges)
    #expect(cache.load()?.id == session.id)
    cache.markSynced()
    #expect(!cache.hasPendingChanges)
}
