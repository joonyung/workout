import Foundation

public enum WorkoutClock {
    public static func timestamp(_ date: Date = Date()) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    public static func localDate(_ date: Date = Date(), calendar: Calendar = .current) -> String {
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return String(
            format: "%04d-%02d-%02d",
            components.year ?? 0,
            components.month ?? 0,
            components.day ?? 0
        )
    }
}

public enum WorkoutSessionFactory {
    public static func makeSession(
        from plan: WorkoutPlan,
        date: Date = Date(),
        calendar: Calendar = .current
    ) -> WorkoutSessionRecord {
        let timestamp = WorkoutClock.timestamp(date)
        let exercises = plan.exercises.map { exercise in
            SessionExercise(
                id: exercise.id,
                name: exercise.name,
                muscleGroup: exercise.muscleGroup,
                targetSets: exercise.targetSets,
                repRange: exercise.repRange,
                targetRpe: exercise.targetRpe,
                restSeconds: exercise.restSeconds,
                startingWeightKg: exercise.startingWeightKg,
                startingWeightLb: exercise.startingWeightLb,
                startingLoad: exercise.startingLoad,
                equipmentId: exercise.equipmentId,
                cue: exercise.cue,
                substitutions: exercise.substitutions,
                sets: (0..<exercise.targetSets).map { index in
                    SessionSet(
                        id: identifier(prefix: "set"),
                        setNumber: index + 1,
                        setType: "working",
                        weightKg: exercise.weightUnit == .kg ? exercise.startingWeightKg : nil,
                        weightLb: exercise.weightUnit == .lb ? exercise.startingWeightLb : nil,
                        reps: NumericValue(),
                        rpe: NumericValue(),
                        completed: false,
                        completedAt: nil,
                        previousWeightKg: nil,
                        previousWeightLb: nil,
                        previousReps: nil,
                        validForProgression: nil
                    )
                }
            )
        }
        let cardio = (plan.cardio ?? []).map { item in
            SessionCardio(
                id: item.id,
                name: item.name,
                targetMinutes: item.targetMinutes,
                rpeRange: item.rpeRange,
                equipmentId: item.equipmentId,
                cue: item.cue,
                substitutions: item.substitutions,
                durationMinutes: NumericValue(item.targetMinutes),
                distanceKm: NumericValue(),
                averageHeartRate: NumericValue(),
                rpe: NumericValue(),
                completed: false,
                completedAt: nil
            )
        }

        return WorkoutSessionRecord(
            schemaVersion: 1,
            id: identifier(prefix: "workout"),
            date: WorkoutClock.localDate(date, calendar: calendar),
            planId: plan.id,
            planDate: plan.date,
            title: plan.title,
            focus: plan.focus,
            gymName: nil,
            startedAt: timestamp,
            updatedAt: timestamp,
            finishedAt: nil,
            readiness: "normal",
            sessionRpe: nil,
            notes: "",
            planSnapshot: PlanSnapshot(
                id: plan.id,
                date: plan.date,
                generatedAt: plan.generatedAt,
                phase: plan.phase
            ),
            exercises: exercises,
            cardio: cardio
        )
    }

    private static func identifier(prefix: String) -> String {
        "\(prefix)-\(UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: ""))"
    }
}

public extension WorkoutSessionRecord {
    var completedWorkingSets: Int {
        exercises.reduce(0) { result, exercise in
            result + exercise.sets.filter { $0.setType != "warmup" && $0.isCompleted }.count
        }
    }

    var targetWorkingSets: Int {
        exercises.reduce(0) { $0 + $1.targetSets }
    }

    var isFinished: Bool { finishedAt != nil }

    mutating func touch(_ date: Date = Date()) {
        updatedAt = WorkoutClock.timestamp(date)
    }
}
