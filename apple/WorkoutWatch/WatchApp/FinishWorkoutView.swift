import SwiftUI

struct FinishWorkoutView: View {
    @EnvironmentObject private var model: WatchWorkoutModel
    @Environment(\.dismiss) private var dismiss
    @State private var sessionRpe = 8.0
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Stepper(value: $sessionRpe, in: 1...10, step: 0.5) {
                        HStack {
                            Text("전체 RPE")
                            Spacer()
                            Text(sessionRpe.formatted()).font(.headline.monospacedDigit())
                        }
                    }
                    TextField("메모 (선택)", text: $notes)
                }
                Section {
                    Button("완료하고 동기화") {
                        model.finish(sessionRpe: sessionRpe, notes: notes)
                        dismiss()
                    }
                    .tint(.green)
                }
            }
            .navigationTitle("운동 마치기")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
