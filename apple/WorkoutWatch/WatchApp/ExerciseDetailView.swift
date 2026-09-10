import SwiftUI
import WorkoutWatchCore

struct ExerciseDetailView: View {
    @EnvironmentObject private var model: WatchWorkoutModel
    let exerciseID: String

    var body: some View {
        List {
            if let exercise = model.exercise(id: exerciseID) {
                if let cue = exercise.cue, !cue.isEmpty {
                    Section("코칭") {
                        Text(cue).font(.caption)
                    }
                }

                Section("작업 세트") {
                    ForEach(exercise.sets) { set in
                        NavigationLink {
                            SetEntryView(exerciseID: exerciseID, setID: set.id)
                        } label: {
                            SetRow(sessionSet: set, unit: exercise.weightUnit)
                        }
                    }
                }
            } else {
                Text("운동을 찾을 수 없습니다.")
            }
        }
        .navigationTitle(model.exercise(id: exerciseID)?.name ?? "운동")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct SetRow: View {
    let sessionSet: SessionSet
    let unit: WeightUnit

    var body: some View {
        HStack {
            Text("\(sessionSet.setNumber ?? 0)")
                .font(.headline.monospacedDigit())
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(weight.formatted())\(unit.rawValue) × \(reps.formatted())")
                    .font(.body.monospacedDigit())
                Text(rpe > 0 ? "RPE \(rpe.formatted())" : "RPE 입력 필요")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: sessionSet.isCompleted ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(sessionSet.isCompleted ? Color.green : Color.secondary)
        }
    }

    private var weight: Double {
        (unit == .lb ? sessionSet.weightLb?.value : sessionSet.weightKg?.value) ?? 0
    }
    private var reps: Double { sessionSet.reps?.value ?? 0 }
    private var rpe: Double { sessionSet.rpe?.value ?? 0 }
}

struct SetEntryView: View {
    @EnvironmentObject private var model: WatchWorkoutModel
    @Environment(\.dismiss) private var dismiss
    let exerciseID: String
    let setID: String

    @State private var weight = 0.0
    @State private var reps = 0
    @State private var rpe = 7.0
    @State private var completed = false
    @State private var loaded = false

    var body: some View {
        Form {
            if let exercise = model.exercise(id: exerciseID) {
                Section("목표") {
                    Text(targetText(exercise))
                        .font(.caption)
                }

                Section {
                    Stepper(value: $weight, in: 0...500, step: weightStep(exercise.weightUnit)) {
                        EntryMetric(title: "중량", value: "\(weight.formatted()) \(exercise.weightUnit.rawValue)")
                    }
                    Stepper(value: $reps, in: 0...50, step: 1) {
                        EntryMetric(title: "반복", value: "\(reps)회")
                    }
                    Stepper(value: $rpe, in: 1...10, step: 0.5) {
                        EntryMetric(title: "RPE", value: rpe.formatted())
                    }
                }

                Section {
                    Toggle("세트 완료", isOn: $completed)
                    Button("저장") {
                        model.saveSet(
                            exerciseID: exerciseID,
                            setID: setID,
                            weight: weight,
                            reps: reps,
                            rpe: rpe,
                            completed: completed
                        )
                        dismiss()
                    }
                    .disabled(weight <= 0 || reps <= 0)
                }
            }
        }
        .navigationTitle("세트 입력")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: loadValues)
    }

    private func loadValues() {
        guard !loaded,
              let exercise = model.exercise(id: exerciseID),
              let set = model.set(exerciseID: exerciseID, setID: setID)
        else { return }
        weight = (exercise.weightUnit == .lb ? set.weightLb?.value : set.weightKg?.value) ?? 0
        reps = Int(set.reps?.value ?? 0)
        rpe = set.rpe?.value ?? exercise.targetRpe
        completed = set.isCompleted
        loaded = true
    }

    private func targetText(_ exercise: SessionExercise) -> String {
        guard exercise.repRange.count >= 2 else { return "RPE \(exercise.targetRpe.formatted())" }
        return "\(exercise.repRange[0])-\(exercise.repRange[1])회 · RPE \(exercise.targetRpe.formatted())"
    }

    private func weightStep(_ unit: WeightUnit) -> Double {
        unit == .lb ? 1 : 0.25
    }
}

private struct EntryMetric: View {
    let title: String
    let value: String

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            Text(value)
                .font(.headline.monospacedDigit())
                .foregroundStyle(.tint)
        }
    }
}
