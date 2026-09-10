import Foundation

public struct NumericValue: Codable, Equatable, Sendable {
    public var value: Double?

    public init(_ value: Double? = nil) {
        self.value = value
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = nil
        } else if let number = try? container.decode(Double.self) {
            value = number
        } else if let string = try? container.decode(String.self) {
            value = Double(string)
        } else {
            value = nil
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let value {
            try container.encode(value)
        } else {
            try container.encode("")
        }
    }
}

public struct ServiceCredentials: Codable, Equatable, Sendable {
    public var serverURL: URL
    public var clientID: String
    public var clientSecret: String

    public init(serverURL: URL, clientID: String, clientSecret: String) {
        self.serverURL = serverURL
        self.clientID = clientID
        self.clientSecret = clientSecret
    }

    public var isComplete: Bool {
        serverURL.scheme == "https" &&
        serverURL.host != nil &&
        !clientID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !clientSecret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

public enum WeightUnit: String, Codable, Sendable {
    case kg
    case lb
}

public struct WorkoutPlan: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var date: String
    public var title: String
    public var focus: String?
    public var generatedAt: String?
    public var phase: String?
    public var exercises: [PlanExercise]
    public var cardio: [PlanCardio]?
}

public struct PlanExercise: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var muscleGroup: String
    public var targetSets: Int
    public var repRange: [Int]
    public var targetRpe: Double
    public var restSeconds: Int
    public var startingWeightKg: NumericValue?
    public var startingWeightLb: NumericValue?
    public var startingLoad: String?
    public var equipmentId: String?
    public var cue: String?
    public var substitutions: [String]?

    public var weightUnit: WeightUnit {
        startingWeightLb != nil ? .lb : .kg
    }
}

public struct PlanCardio: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var targetMinutes: Double
    public var rpeRange: [Double]
    public var equipmentId: String?
    public var cue: String?
    public var substitutions: [String]?
}

public struct WorkoutSessionRecord: Codable, Equatable, Sendable, Identifiable {
    public var schemaVersion: Int?
    public var id: String
    public var date: String
    public var planId: String?
    public var planDate: String?
    public var title: String?
    public var focus: String?
    public var gymName: String?
    public var startedAt: String?
    public var updatedAt: String?
    public var finishedAt: String?
    public var readiness: String?
    public var sessionRpe: Double?
    public var notes: String?
    public var planSnapshot: PlanSnapshot?
    public var exercises: [SessionExercise]
    public var cardio: [SessionCardio]?
}

public struct PlanSnapshot: Codable, Equatable, Sendable {
    public var id: String
    public var date: String
    public var generatedAt: String?
    public var phase: String?
}

public struct SessionExercise: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var muscleGroup: String
    public var targetSets: Int
    public var repRange: [Int]
    public var targetRpe: Double
    public var restSeconds: Int
    public var startingWeightKg: NumericValue?
    public var startingWeightLb: NumericValue?
    public var startingLoad: String?
    public var equipmentId: String?
    public var cue: String?
    public var substitutions: [String]?
    public var sets: [SessionSet]

    public var weightUnit: WeightUnit {
        startingWeightLb != nil || sets.contains(where: { $0.weightLb != nil }) ? .lb : .kg
    }
}

public struct SessionSet: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var setNumber: Int?
    public var setType: String?
    public var weightKg: NumericValue?
    public var weightLb: NumericValue?
    public var reps: NumericValue?
    public var rpe: NumericValue?
    public var completed: Bool?
    public var completedAt: String?
    public var previousWeightKg: NumericValue?
    public var previousWeightLb: NumericValue?
    public var previousReps: NumericValue?
    public var validForProgression: Bool?

    public var isCompleted: Bool { completed == true }
}

public struct SessionCardio: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var targetMinutes: Double
    public var rpeRange: [Double]
    public var equipmentId: String?
    public var cue: String?
    public var substitutions: [String]?
    public var durationMinutes: NumericValue?
    public var distanceKm: NumericValue?
    public var averageHeartRate: NumericValue?
    public var rpe: NumericValue?
    public var completed: Bool
    public var completedAt: String?
}

public struct WatchBootstrap: Codable, Equatable, Sendable {
    public var plan: WorkoutPlan?
    public var session: WorkoutSessionRecord?
    public var serverTime: String
}

public struct WorkoutSaveResult: Codable, Equatable, Sendable {
    public var ok: Bool
    public var savedAt: String?
    public var discarded: Bool?
    public var reason: String?
    public var currentUpdatedAt: String?
}
