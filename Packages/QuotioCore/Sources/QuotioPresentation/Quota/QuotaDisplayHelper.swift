import QuotioDomain
import SwiftUI

struct QuotaDisplayHelper {
    let displayMode: QuotaDisplayMode

    func statusColor(remainingPercent: Double) -> Color {
        let clamped = max(0, min(100, remainingPercent))
        let usedPercent = 100 - clamped
        let checkValue = displayMode == .used ? usedPercent : clamped

        if displayMode == .used {
            if checkValue < 70 { return .green }
            if checkValue < 90 { return .yellow }
            return .red
        }

        if checkValue > 50 { return .green }
        if checkValue > 20 { return .orange }
        return .red
    }

    func displayPercent(remainingPercent: Double) -> Double {
        let clamped = max(0, min(100, remainingPercent))
        return displayMode == .used ? (100 - clamped) : clamped
    }
}
