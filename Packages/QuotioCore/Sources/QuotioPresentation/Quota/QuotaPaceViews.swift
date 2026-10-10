import QuotioDomain
import SwiftUI

/// One limit as the pace-tick meters draw it.
@MainActor
struct QuotaMeter {
    enum Tone { case good, behind, critical, unknown }

    let metric: QuotaMetric
    let displayMode: QuotaDisplayMode
    let pace: QuotaPace?
    let tone: Tone

    init(metric: QuotaMetric, displayMode: QuotaDisplayMode, now: Date = Date()) {
        self.metric = metric
        self.displayMode = displayMode
        pace = metric.pace(now: now)
        tone = Self.tone(remaining: metric.percentage, pace: pace)
    }

    var name: String { metric.displayName }
    var hasData: Bool { metric.percentage >= 0 }
    var remaining: Double { max(0, min(100, metric.percentage)) }
    var isExhausted: Bool { hasData && remaining <= 0 }
    var resetsAt: Date? { metric.resetDate }

    var displayValue: Double { displayMode.displayValue(from: remaining) }
    var valueText: String { hasData ? "\(Int(displayValue.rounded()))%" : "—" }

    /// Where the even-pace mark sits on the bar, in the same direction as the fill.
    var tickFraction: Double? {
        guard let pace else { return nil }
        let expected = displayMode == .used ? 100 - pace.expectedRemaining : pace.expectedRemaining
        return min(1, max(0, expected / 100))
    }

    var color: Color { tone.color }

    /// Value text stays in label color unless the limit needs attention.
    var valueColor: Color {
        switch tone {
        case .good, .unknown: .primary
        case .behind, .critical: tone.color
        }
    }

    /// Without a window length, colors fall back to fixed thresholds on what is left.
    private static func tone(remaining: Double, pace: QuotaPace?) -> Tone {
        guard remaining >= 0 else { return .unknown }
        if remaining <= 0 { return .critical }
        if let pace { return pace.status == .behind ? .behind : .good }
        if remaining > 50 { return .good }
        if remaining > 20 { return .behind }
        return .critical
    }
}

extension QuotaMeter.Tone {
    var color: Color {
        switch self {
        case .good: .green
        case .behind: .orange
        case .critical: .red
        case .unknown: .secondary
        }
    }
}

// MARK: - Formatting

enum QuotaTimeText {
    /// "1h 42m", "2d 3h", "34m".
    static func duration(until date: Date, now: Date = Date()) -> String {
        let minutes = max(1, Int(date.timeIntervalSince(now) / 60))
        let days = minutes / 1440, hours = minutes % 1440 / 60, mins = minutes % 60
        if days > 0 { return hours > 0 ? "\(days)d \(hours)h" : "\(days)d" }
        if hours > 0 { return mins > 0 ? "\(hours)h \(mins)m" : "\(hours)h" }
        return "\(mins)m"
    }

    static func weekdayTime(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }

    static func weekday(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.abbreviated))
    }

    static func time(_ date: Date) -> String {
        date.formatted(.dateTime.hour().minute())
    }

    /// Within a day the countdown reads better than a clock time.
    @MainActor
    static func reset(_ date: Date, now: Date = Date()) -> String {
        if date.timeIntervalSince(now) < 86_400 {
            return String(format: "quota.reset.in".localized(), duration(until: date, now: now))
        }
        return String(format: "quota.reset.at".localized(), weekdayTime(date))
    }

    static func percent(_ value: Double) -> String {
        "\(max(1, Int(value.rounded())))%"
    }
}

// MARK: - Bar

/// Remaining (or used) fill with a tick where an even pace would be. When the
/// fill falls short of the tick, the gap between them is tinted.
struct QuotaPaceBar: View {
    let meter: QuotaMeter
    var height: CGFloat = 6
    var tickOverhang: CGFloat = 3

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let fill = meter.hasData ? width * meter.displayValue / 100 : 0
            ZStack(alignment: .leading) {
                Capsule().fill(meter.isExhausted ? AnyShapeStyle(Color.red.opacity(0.12)) : AnyShapeStyle(.fill.tertiary))
                if meter.tone == .behind, let tick = meter.tickFraction {
                    let lower = min(fill, width * tick), upper = max(fill, width * tick)
                    Rectangle()
                        .fill(Color.orange.opacity(0.25))
                        .frame(width: upper - lower)
                        .offset(x: lower)
                }
                Capsule()
                    .fill(meter.color)
                    .frame(width: fill)
                if !meter.isExhausted, let tick = meter.tickFraction {
                    Rectangle()
                        .fill(.primary)
                        .frame(width: 2, height: height + tickOverhang * 2)
                        .offset(x: min(width - 2, max(0, width * tick - 1)))
                }
            }
            .frame(height: height)
            .frame(maxHeight: .infinity)
        }
        .frame(height: height + tickOverhang * 2)
        .accessibilityHidden(true)
    }
}

// MARK: - Rows

/// Comfortable density: name and value, the pace bar, then reset or projection.
struct QuotaLimitRow: View {
    let meter: QuotaMeter

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(meter.name)
                    .font(.callout)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(meter.valueText)
                    .font(.callout.weight(.semibold).monospacedDigit())
                    .foregroundStyle(meter.valueColor)
            }
            QuotaPaceBar(meter: meter)
            footer
                .font(.caption)
        }
        .menuNativeTooltip(meter.metric.tooltip ?? "")
    }

    @ViewBuilder private var footer: some View {
        if meter.tone == .behind, let empty = meter.pace?.projectedEmpty {
            HStack(spacing: 8) {
                Text(String(format: "quota.pace.emptyAt".localized(), QuotaTimeText.weekdayTime(empty)))
                    .foregroundStyle(.orange)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if let reset = meter.resetsAt {
                    Text(QuotaTimeText.reset(reset))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        } else if let reset = meter.resetsAt, reset > Date() {
            Text(QuotaTimeText.reset(reset))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        } else {
            // Keeps every row the same height whether or not a reset is known.
            Text(" ").accessibilityHidden(true)
        }
    }
}

/// A limit that has run out: what ran out, when it comes back, and a countdown.
struct QuotaExhaustedBanner: View {
    let meter: QuotaMeter

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(.red)
            VStack(alignment: .leading, spacing: 1) {
                Text(String(format: "quota.exhausted.title".localized(), meter.name))
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.red)
                    .lineLimit(1)
                if let reset = meter.resetsAt {
                    Text(String(format: "quota.exhausted.back".localized(), QuotaTimeText.time(reset)))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            if let reset = meter.resetsAt, reset > Date() {
                Label(QuotaTimeText.duration(until: reset), systemImage: "clock")
                    .font(.callout.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.primary)
                    .labelStyle(.titleAndIcon)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .menuNativeTooltip(meter.metric.tooltip ?? "")
    }
}

// MARK: - Detailed

/// Detailed density: the window so far, the even-pace line, where the current
/// rate leads, and a daily budget that would last until the reset.
struct QuotaBurnCard: View {
    let meter: QuotaMeter
    let pace: QuotaPace

    private var isBehind: Bool { meter.tone == .behind }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(meter.name)
                    .font(.callout.weight(.medium))
                Spacer(minLength: 8)
                Text(meter.valueText)
                    .font(.callout.weight(.semibold).monospacedDigit())
                    .foregroundStyle(meter.valueColor)
            }
            QuotaBurnChart(meter: meter, pace: pace)
            Divider().opacity(0.6)
            advice
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .background {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(isBehind ? AnyShapeStyle(Color.orange.opacity(0.07)) : AnyShapeStyle(.fill.quaternary))
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(isBehind ? Color.orange.opacity(0.25) : .clear)
        }
    }

    private var advice: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "gauge.with.dots.needle.67percent")
                .foregroundStyle(isBehind ? .orange : .secondary)
            adviceText
        }
    }

    private var adviceText: Text {
        let estimated = Text(" " + "quota.pace.estimated".localized()).foregroundStyle(.tertiary)
        guard pace.usedPerDay > 0 else {
            return Text("quota.pace.noRate".localized()).foregroundStyle(.secondary) + estimated
        }
        let rate = Text(String(format: "quota.pace.rate".localized(), QuotaTimeText.percent(pace.usedPerDay)))
            .fontWeight(.semibold)
            .foregroundStyle(isBehind ? .orange : .primary)
        let plan = isBehind
            ? String(format: "quota.pace.budget".localized(), QuotaTimeText.weekdayTime(pace.resetsAt),
                     QuotaTimeText.percent(pace.budgetPerDay))
            : "quota.pace.onTrack".localized()
        return rate + Text(" " + plan).foregroundStyle(.secondary) + estimated
    }
}

private struct QuotaBurnChart: View {
    let meter: QuotaMeter
    let pace: QuotaPace
    private let plotHeight: CGFloat = 56

    private var isBehind: Bool { meter.tone == .behind }

    var body: some View {
        let now = Date()
        VStack(spacing: 4) {
            GeometryReader { proxy in
                let size = proxy.size
                let x = { (date: Date) in xPosition(date, width: size.width) }
                let y = { (remaining: Double) in size.height * (1 - remaining / 100) }
                let current = CGPoint(x: x(now), y: y(pace.remaining))
                let start = CGPoint(x: 0, y: y(100))
                let end = projectionEnd(now: now, size: size)

                Path { path in
                    path.move(to: start)
                    path.addLine(to: current)
                    path.addLine(to: CGPoint(x: current.x, y: size.height))
                    path.addLine(to: CGPoint(x: 0, y: size.height))
                    path.closeSubpath()
                }
                .fill(meter.color.opacity(0.15))

                Path { path in
                    path.move(to: start)
                    path.addLine(to: CGPoint(x: size.width, y: size.height))
                }
                .stroke(.secondary, style: StrokeStyle(lineWidth: 1, dash: [1, 3]))

                Path { path in
                    path.move(to: start)
                    path.addLine(to: current)
                }
                .stroke(meter.color, style: StrokeStyle(lineWidth: 2, lineCap: .round))

                Path { path in
                    path.move(to: current)
                    path.addLine(to: end)
                }
                .stroke(isBehind ? .red : meter.color, style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))

                if isBehind {
                    Circle().fill(.red).frame(width: 5, height: 5).position(end)
                }

                Rectangle()
                    .fill(.blue)
                    .frame(width: 1.5, height: size.height)
                    .position(x: size.width - 0.75, y: size.height / 2)

                Circle()
                    .strokeBorder(meter.color, lineWidth: 1.5)
                    .background(Circle().fill(.background))
                    .frame(width: 8, height: 8)
                    .position(current)
            }
            .frame(height: plotHeight)

            axisLabels(now: now)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(meter.name + " " + meter.valueText)
    }

    /// Weekdays repeat inside a short window, so those read as clock times.
    private func axisText(_ date: Date) -> String {
        pace.resetsAt.timeIntervalSince(pace.windowStart) >= 2 * 86_400
            ? QuotaTimeText.weekday(date) : QuotaTimeText.time(date)
    }

    private func xPosition(_ date: Date, width: CGFloat) -> CGFloat {
        let span = pace.resetsAt.timeIntervalSince(pace.windowStart)
        let fraction = date.timeIntervalSince(pace.windowStart) / span
        return width * min(1, max(0, fraction))
    }

    private func projectionEnd(now: Date, size: CGSize) -> CGPoint {
        if let empty = pace.projectedEmpty {
            return CGPoint(x: xPosition(empty, width: size.width), y: size.height)
        }
        let daysLeft = pace.resetsAt.timeIntervalSince(now) / 86_400
        let left = max(0, pace.remaining - pace.usedPerDay * daysLeft)
        return CGPoint(x: size.width, y: size.height * (1 - left / 100))
    }

    /// Start and reset labels pin to the edges; "Now" and the projected empty
    /// day sit under their points and drop out when they would collide.
    private func axisLabels(now: Date) -> some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let nowX = xPosition(now, width: width)
            let emptyX = pace.projectedEmpty.map { xPosition($0, width: width) }
            let reset = Text(String(format: "quota.chart.reset".localized(), axisText(pace.resetsAt)))
            ZStack(alignment: .topLeading) {
                Text(axisText(pace.windowStart))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                reset
                    .foregroundStyle(.blue)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                if nowX > 40, nowX < width - 90, !isBehind || emptyX.map({ abs($0 - nowX) > 40 }) ?? true {
                    Text("quota.chart.now".localized())
                        .foregroundStyle(.primary)
                        .fixedSize()
                        .position(x: nowX, y: 6)
                }
                if isBehind, let empty = pace.projectedEmpty, let emptyX, emptyX > 40, emptyX < width - 90 {
                    Text(axisText(empty))
                        .fontWeight(.semibold)
                        .foregroundStyle(.red)
                        .fixedSize()
                        .position(x: emptyX, y: 6)
                }
            }
        }
        .font(.caption2)
        .frame(height: 12)
    }
}
