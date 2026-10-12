import Charts
import QuotioDomain
import SwiftUI

public struct QuotaHistorySheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model: QuotaHistoryScreenModel
    @State private var confirmsClear = false
    @State private var isHoveringChart = false
    @FocusState private var chartFocused: Bool
    private let accountName: String
    private let provider: QuotaProvider
    private let displayMode: QuotaDisplayMode
    private let hideSensitiveInfo: Bool

    public init(model: QuotaHistoryScreenModel, accountName: String, provider: QuotaProvider,
                displayMode: QuotaDisplayMode = .remaining, hideSensitiveInfo: Bool = false) {
        _model = State(initialValue: model)
        self.accountName = accountName; self.provider = provider
        self.displayMode = displayMode; self.hideSensitiveInfo = hideSensitiveInfo
    }
    private var helper: QuotaDisplayHelper { .init(displayMode: displayMode) }
    private var levelKey: String { displayMode == .remaining ? "history.remaining" : "history.used" }
    /// The live limit paced as the menu paces it, or nil when its window or reset is unknown.
    private var meter: QuotaMeter? {
        guard let metric = model.liveMetric else { return nil }
        let meter = QuotaMeter(metric: metric, displayMode: displayMode)
        return meter.pace == nil ? nil : meter
    }

    private enum Content {
        case loading, failed(QuotaHistoryError), empty(String), noPercentage, amounts(QuotaHistoryChart), chart(QuotaHistoryChart)
    }
    private var content: Content {
        if let chart = model.chart {
            if chart.bins.isEmpty { return .empty(emptyKey) }
            return model.selectedMetric?.hasPercentage == true ? .chart(chart) : .amounts(chart)
        }
        if let error = model.error { return .failed(error) }
        guard let catalog = model.catalog, !model.isLoading else { return .loading }
        if !catalog.metrics.isEmpty && !catalog.metrics.contains(where: { $0.hasPercentage }) { return .noPercentage }
        return .empty(emptyKey)
    }

    public var body: some View {
        VStack(spacing: 0) {
            header.padding(.horizontal, 20).padding(.vertical, 14)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 10) {
                        controls
                        banners
                    }
                    switch content {
                    case .loading:
                        placeholder { ContentUnavailableView { ProgressView().controlSize(.small) } description: { Text("history.loading".localized()) } }
                    case .failed(let error):
                        placeholder {
                            ContentUnavailableView {
                                Label(errorTitleKey(error).localized(), systemImage: errorSymbol(error))
                            } description: { Text((error == .offline ? "history.offlineEmpty" : errorKey(error)).localized()) } actions: {
                                if canRetry(error) { Button("action.retry".localized()) { model.reload() } }
                            }
                        }
                    case .empty(let key):
                        placeholder { ContentUnavailableView { Label("history.emptyTitle".localized(), systemImage: "chart.bar.xaxis") } description: { Text(key.localized()) } }
                    case .noPercentage:
                        placeholder { ContentUnavailableView { Label("history.noPercentageTitle".localized(), systemImage: "number") } description: { Text("history.amountOnly".localized()) } }
                    case .amounts(let chart):
                        amounts(chart)
                        eventList
                    case .chart(let chart):
                        hero(chart)
                        chartCard(chart)
                        eventList
                    }
                    Label { Text("history.coverage".localized()).fixedSize(horizontal: false, vertical: true) } icon: { Image(systemName: "info.circle") }
                        .font(.caption).foregroundStyle(.secondary)
                }.padding(20)
            }
        }
        .frame(minWidth: 440, idealWidth: 720, maxWidth: 840, minHeight: 540, idealHeight: 760)
        .background(Color(nsColor: .windowBackgroundColor))
        .task { model.start() }
        .onDisappear { model.stop() }
        .confirmationDialog("history.clearAccount".localized(), isPresented: $confirmsClear, titleVisibility: .visible) {
            Button("history.clearAccount".localized(), role: .destructive) { Task { await model.clearAccount() } }
            Button("action.cancel".localized(), role: .cancel) {}
        } message: { Text("history.clearHelp".localized()) }
    }

    private var header: some View {
        HStack(spacing: 12) {
            ProviderIcon(provider: provider, size: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text("history.title".localized()).font(.title3.weight(.semibold)).lineLimit(1)
                HStack(spacing: 4) {
                    Text(provider.displayName).foregroundStyle(.secondary).lineLimit(1).fixedSize()
                    Text("·").foregroundStyle(.tertiary)
                    SensitiveAccountText(value: accountName, isSensitive: hideSensitiveInfo)
                        .lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                }.font(.subheadline)
            }
            Spacer(minLength: 12)
            if model.isClearing { ProgressView().controlSize(.small) }
            Menu {
                Button("history.clearAccount".localized(), role: .destructive) { confirmsClear = true }
                    .disabled(!model.availability.connected || !model.availability.canWrite || model.isClearing)
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            .help("history.moreActions".localized()).accessibilityLabel("history.moreActions".localized())
            Button("action.done".localized()) { dismiss() }.keyboardShortcut(.cancelAction)
        }
    }

    private var controls: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                metricPicker.fixedSize()
                Spacer(minLength: 8)
                refreshIndicator
                rangePicker.fixedSize()
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack { metricPicker; Spacer(minLength: 8); refreshIndicator }
                rangePicker
            }
        }
    }
    @ViewBuilder private var metricPicker: some View {
        if let catalog = model.catalog, !catalog.metrics.isEmpty {
            Picker("history.metric".localized(), selection: Binding(get: { model.metricID ?? "" }, set: { model.select(metricID: $0) })) {
                if model.metricID == nil { Text("history.chooseMetric".localized()).tag("") }
                ForEach(catalog.metrics) { metric in
                    Text(metric.displayName + (metric.current ? "" : " — " + "history.historicalOnly".localized())).tag(metric.id)
                }
            }
            .pickerStyle(.menu).labelsHidden()
        }
    }
    private var rangePicker: some View {
        Picker("history.range".localized(), selection: Binding(get: { model.range }, set: { model.select(range: $0) })) {
            ForEach(QuotaHistoryRange.allCases) { range in Text(("history.range." + range.rawValue).localized()).tag(range) }
        }
        .pickerStyle(.segmented).labelsHidden()
    }
    @ViewBuilder private var refreshIndicator: some View {
        if model.isLoading && model.chart != nil { ProgressView().controlSize(.small).help("history.loading".localized()) }
    }

    @ViewBuilder private var banners: some View {
        if let error = model.error, model.chart != nil {
            banner(errorKey(error), systemImage: errorSymbol(error), tint: error == .offline ? .gray : .orange, retry: canRetry(error))
        }
        if model.catalog?.recordingEnabled == false || model.chart?.recordingEnabled == false, model.chart?.bins.isEmpty == false {
            banner("history.paused", systemImage: "pause.circle", tint: .yellow)
        }
        if model.catalog?.recordingError != nil || model.chart?.recordingError != nil {
            banner("history.recordingFailed", systemImage: "exclamationmark.triangle", tint: .orange)
        }
        if model.mutationError != nil { banner("history.clearFailed", systemImage: "exclamationmark.triangle", tint: .orange) }
    }
    private func banner(_ key: String, systemImage: String, tint: Color, retry: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: systemImage).foregroundStyle(tint)
            Text(key.localized()).fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
            if retry { Button("action.retry".localized()) { model.reload() }.controlSize(.small) }
        }
        .font(.callout)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(tint.opacity(0.12)))
    }
    private func placeholder(@ViewBuilder _ content: () -> some View) -> some View {
        content().frame(maxWidth: .infinity, minHeight: 320)
    }

    private var emptyKey: String {
        if model.catalog?.recordingEnabled == false { return "history.disabledEmpty" }
        if model.catalog?.metrics.isEmpty == true || model.catalog?.firstObservedAt == nil { return "history.startedEmpty" }
        return "history.rangeEmpty"
    }
    private func errorKey(_ error: QuotaHistoryError) -> String {
        switch error {
        case .offline: "history.offline"
        case .hostChanged: "history.hostChanged"
        case .unsupported: "history.unsupported"
        case .unauthorized: "history.ownerOnly"
        case .storage: "history.storageFailed"
        case .invalidResponse, .requestFailed: "history.readFailed"
        }
    }
    private func errorTitleKey(_ error: QuotaHistoryError) -> String {
        switch error {
        case .offline: "history.offlineTitle"
        case .hostChanged, .unsupported, .unauthorized: "history.unavailableTitle"
        case .storage, .invalidResponse, .requestFailed: "history.readFailedTitle"
        }
    }
    private func errorSymbol(_ error: QuotaHistoryError) -> String {
        switch error {
        case .offline: "wifi.slash"
        case .hostChanged, .unsupported, .unauthorized: "lock.slash"
        case .storage, .invalidResponse, .requestFailed: "exclamationmark.triangle"
        }
    }
    private func canRetry(_ error: QuotaHistoryError) -> Bool { error != .unsupported && error != .unauthorized && error != .hostChanged }

    private func hero(_ chart: QuotaHistoryChart) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 16) {
                headline(chart)
                Spacer(minLength: 12)
                HStack(alignment: .top, spacing: 10) { stats(chart).frame(width: 150) }.fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 12) {
                headline(chart)
                HStack(alignment: .top, spacing: 10) { stats(chart).frame(maxWidth: .infinity) }.fixedSize(horizontal: false, vertical: true)
            }
        }
    }
    @ViewBuilder private func headline(_ chart: QuotaHistoryChart) -> some View {
        if let latest = chart.latest {
            VStack(alignment: .leading, spacing: 4) {
                Text(levelKey.localized()).font(.subheadline).foregroundStyle(.secondary)
                Text(valueText(latest))
                    .font(.system(size: 40, weight: .semibold, design: .rounded)).monospacedDigit()
                    .foregroundStyle(latest.remainingPercent.map { helper.statusColor(remainingPercent: $0) } ?? .secondary)
                    .lineLimit(1).minimumScaleFactor(0.6)
                if let pace = meter?.pace { drainRate(pace) }
                HStack(spacing: 6) {
                    Text(String(format: "history.updated".localized(), latest.fetchedAt.formatted(.relative(presentation: .named))))
                        .font(.caption).foregroundStyle(.secondary)
                        .help(time(latest.fetchedAt))
                    if latest.expiresAt.map({ $0 <= Date() }) == true {
                        badge("history.badge.stale", tint: .orange).help("history.stale".localized())
                    }
                    if latest.confidence != .exact {
                        badge(latest.confidence == .estimated ? "history.badge.estimated" : "history.confidence.unknown", tint: .secondary)
                    }
                }
            }
        }
    }
    private func drainRate(_ pace: QuotaPace) -> some View {
        Label {
            if pace.usedPerDay > 0 {
                Text(QuotaRateText(pace).rate(perDay: pace.usedPerDay)).fontWeight(.medium).foregroundStyle(.primary)
            } else {
                Text("quota.pace.noRate".localized()).foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: displayMode == .remaining ? "arrow.down.right" : "arrow.up.right").foregroundStyle(.secondary)
        }
        .font(.callout).lineLimit(1)
    }
    private func badge(_ key: String, tint: Color) -> some View {
        Text(key.localized()).font(.caption2.weight(.medium)).foregroundStyle(tint)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Capsule().fill(tint.opacity(0.14)))
    }
    @ViewBuilder private func stats(_ chart: QuotaHistoryChart) -> some View {
        if let latest = chart.latest {
            if let date = latest.resetsAt {
                tile("history.expectedReset", systemImage: "clock.arrow.circlepath",
                     value: date.formatted(.relative(presentation: .numeric, unitsStyle: .abbreviated)), caption: time(date))
            } else if let description = latest.resetDescription {
                tile("history.expectedReset", systemImage: "clock.arrow.circlepath", value: description, caption: nil)
            }
        }
        if let meter, let pace = meter.pace, !meter.isExhausted {
            forecastTile(meter, pace)
        } else if let lowest = chart.lowestRemainingPercent {
            tile(displayMode == .remaining ? "history.lowest" : "history.highestUsed",
                 systemImage: displayMode == .remaining ? "arrow.down.to.line" : "arrow.up.to.line", value: percentage(lowest), caption: nil)
        }
    }
    @ViewBuilder private func forecastTile(_ meter: QuotaMeter, _ pace: QuotaPace) -> some View {
        if let empty = pace.projectedEmpty {
            tile("history.forecast", systemImage: "exclamationmark.triangle",
                 value: String(format: "history.forecast.runsOut".localized(), QuotaTimeText.weekdayTime(empty)),
                 caption: QuotaTimeText.reset(pace.resetsAt, onDate: meter.resetsOnDate), tint: meter.color)
        } else {
            tile("history.forecast", systemImage: "checkmark.circle", value: "history.forecast.lasts".localized(),
                 caption: String(format: "quota.advice.leftAtReset".localized(), QuotaTimeText.percent(pace.remainingAtReset(now: Date()))),
                 tint: meter.color)
        }
    }
    private func tile(_ key: String, systemImage: String, value: String, caption: String?, tint: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(key.localized(), systemImage: systemImage).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Text(value).font(.title3.weight(.semibold)).foregroundStyle(tint).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
            if let caption { Text(caption).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.primary.opacity(0.04)))
    }

    private func card(@ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 12, content: content)
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(nsColor: .controlBackgroundColor)))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.primary.opacity(0.06), lineWidth: 0.5))
    }
    private func chartCard(_ chart: QuotaHistoryChart) -> some View {
        card {
            timeline(chart)
            legend(chart)
            if let bin = model.selectedBin {
                Divider()
                detail(bin)
            }
        }
    }
    private var boundaries: [QuotaHistoryEvent] { model.events.filter { $0.kind == .basisChanged || $0.kind == .clockChanged } }
    private var inferredResets: [QuotaHistoryEvent] { model.events.filter { $0.kind == .resetInferred } }

    private func timeline(_ chart: QuotaHistoryChart) -> some View {
        let now = Date()
        let meter = meter
        let pace = meter?.pace
        let end = chartEnd(chart, now: now, paced: pace != nil)
        let tint = meter?.color ?? helper.statusColor(remainingPercent: chart.latest?.remainingPercent ?? 100)
        let fill = LinearGradient(colors: [tint.opacity(0.22), tint.opacity(0.02)], startPoint: .top, endPoint: .bottom)
        return Chart {
            if let pace {
                RectangleMark(xStart: .value("history.start", now), xEnd: .value("history.end", end),
                              yStart: .value("history.baseline", 0.0), yEnd: .value("history.percent", 100.0))
                    .foregroundStyle(Color.primary.opacity(0.03))
                ForEach(Array(projection(pace, from: now, until: end).enumerated()), id: \.offset) { _, point in
                    let value = helper.displayPercent(remainingPercent: point.remaining)
                    AreaMark(x: .value("history.time", point.date), y: .value("history.percent", value),
                             series: .value("history.series", "projection"), stacking: .unstacked)
                        .foregroundStyle(tint.opacity(0.06))
                    LineMark(x: .value("history.time", point.date), y: .value("history.percent", value),
                             series: .value("history.series", "projection"))
                        .foregroundStyle(tint.opacity(0.8)).lineStyle(.init(lineWidth: 2, dash: [5, 4]))
                }
            }
            ForEach(inferredResets) { event in
                let band = resetBand(event, chart: chart)
                RectangleMark(xStart: .value("history.start", band.lowerBound), xEnd: .value("history.end", band.upperBound),
                              yStart: .value("history.baseline", 0.0), yEnd: .value("history.percent", 100.0))
                    .foregroundStyle(Color.accentColor.opacity(0.2))
            }
            ForEach(Array(observedSegments(chart).enumerated()), id: \.offset) { index, segment in
                let series = "observed-\(index)"
                ForEach(segment) { bin in
                    let value = helper.displayPercent(remainingPercent: bin.latest.remainingPercent ?? 0)
                    AreaMark(x: .value("history.time", midpoint(bin)), y: .value("history.percent", value),
                             series: .value("history.series", series), stacking: .unstacked)
                        .foregroundStyle(fill)
                    LineMark(x: .value("history.time", midpoint(bin)), y: .value("history.percent", value),
                             series: .value("history.series", series))
                        .foregroundStyle(tint).lineStyle(.init(lineWidth: 2, lineCap: .round, lineJoin: .round))
                    if segment.count == 1 {
                        PointMark(x: .value("history.time", midpoint(bin)), y: .value("history.percent", value))
                            .symbolSize(16).foregroundStyle(tint)
                    }
                }
            }
            ForEach(chart.bins.filter { $0.latest.remainingPercent == nil }) { bin in
                PointMark(x: .value("history.time", midpoint(bin)), y: .value("history.percent", 0))
                    .symbol(.square).symbolSize(20).foregroundStyle(Color.secondary)
            }
            ForEach(boundaries) { event in
                RuleMark(x: .value("history.boundary", event.toAt)).lineStyle(.init(lineWidth: 1, dash: [3, 3])).foregroundStyle(Color.secondary)
            }
            if let meter, let pace, pace.resetsAt <= end {
                RuleMark(x: .value("history.reset", pace.resetsAt))
                    .foregroundStyle(Color.blue.opacity(0.6)).lineStyle(.init(lineWidth: 1, dash: [3, 3]))
                    .annotation(position: .topTrailing, spacing: 2, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        Text(String(format: "quota.chart.reset".localized(), QuotaRateText(pace).resetTime(pace, onDate: meter.resetsOnDate)))
                            .font(.caption2.weight(.semibold)).foregroundStyle(.blue)
                    }
            }
            if let pace {
                // Near the reset, the two labels would overlap, so the reset label wins.
                let labelsNow = pace.resetsAt.timeIntervalSince(now) > end.timeIntervalSince(chart.startAt) / 6
                RuleMark(x: .value("history.now", now))
                    .foregroundStyle(Color.primary.opacity(0.7)).lineStyle(.init(lineWidth: 1, dash: [2, 3]))
                    .annotation(position: .topLeading, spacing: 2, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        if labelsNow { Text("quota.chart.now".localized()).font(.caption2.weight(.semibold)) }
                    }
            }
            if let selected = model.selectedBin {
                RuleMark(x: .value("history.selected", midpoint(selected)))
                    .foregroundStyle(Color.primary.opacity(isHoveringChart || chartFocused ? 0.5 : 0)).lineStyle(.init(lineWidth: 1))
                    .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        if isHoveringChart || chartFocused { tooltip(selected) }
                    }
                if let remaining = selected.latest.remainingPercent {
                    PointMark(x: .value("history.selected", midpoint(selected)),
                              y: .value("history.percent", helper.displayPercent(remainingPercent: remaining)))
                        .symbol {
                            Circle().strokeBorder(tint, lineWidth: 2).background(Circle().fill(Color(nsColor: .controlBackgroundColor))).frame(width: 9, height: 9)
                        }
                }
            }
        }
        .chartXScale(domain: chart.startAt...end)
        .chartYScale(domain: 0...100)
        .chartYAxis {
            AxisMarks(position: .leading, values: [0, 25, 50, 75, 100]) { value in
                AxisGridLine(); AxisValueLabel { if let number = value.as(Int.self) { Text("\(number)%") } }
            }
        }
        .chartXAxis {
            switch chart.range {
            case .day:
                AxisMarks(values: .stride(by: .hour, count: 4)) { _ in AxisGridLine(); AxisTick(); AxisValueLabel(format: .dateTime.hour()) }
            case .week:
                AxisMarks(values: .stride(by: .day)) { _ in AxisGridLine(); AxisTick(); AxisValueLabel(format: .dateTime.weekday(.abbreviated)) }
            case .month:
                AxisMarks(values: .stride(by: .day, count: 6)) { _ in AxisGridLine(); AxisTick(); AxisValueLabel(format: .dateTime.day().month(.abbreviated)) }
            }
        }
        .frame(height: 220).padding(.top, 12)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: model.selectedBinID)
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .onContinuousHover { phase in
                        switch phase {
                        case .active(let location): isHoveringChart = select(location, proxy: proxy, geometry: geometry) || isHoveringChart
                        case .ended: isHoveringChart = false
                        }
                    }
                    .onTapGesture { location in _ = select(location, proxy: proxy, geometry: geometry); chartFocused = true }
            }
        }
        .focusable().focused($chartFocused)
        .onKeyPress(.leftArrow) { model.moveSelection(by: -1); return .handled }
        .onKeyPress(.rightArrow) { model.moveSelection(by: 1); return .handled }
        .help("history.keyboardHelp".localized())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(levelKey.localized())
        .accessibilityValue(model.selectedBin.map(accessibilityDetail) ?? "history.rangeEmpty".localized())
        .accessibilityHint("history.keyboardHelp".localized())
        .accessibilityAdjustableAction { direction in model.moveSelection(by: direction == .increment ? 1 : -1) }
    }
    /// A sixth of the range past the latest bin leaves room for the projection without squeezing history.
    private func chartEnd(_ chart: QuotaHistoryChart, now: Date, paced: Bool) -> Date {
        guard paced else { return chart.endAt }
        return max(chart.endAt, now).addingTimeInterval(chart.endAt.timeIntervalSince(chart.startAt) / 6)
    }
    /// The pace's rate carried from now to `end`, refilling to 100% at the reset and
    /// assuming the next window is used at the same rate.
    private func projection(_ pace: QuotaPace, from now: Date, until end: Date) -> [(date: Date, remaining: Double)] {
        let perSecond = pace.usedPerDay / 86_400
        func decline(from start: (date: Date, remaining: Double), until stop: Date) -> [(date: Date, remaining: Double)] {
            guard perSecond > 0 else { return [(stop, start.remaining)] }
            let empty = start.date.addingTimeInterval(start.remaining / perSecond)
            if empty < stop { return [(empty, 0), (stop, 0)] }
            return [(stop, start.remaining - perSecond * stop.timeIntervalSince(start.date))]
        }
        let start = (date: now, remaining: pace.remaining)
        guard pace.resetsAt < end else { return [start] + decline(from: start, until: end) }
        let refill = (date: pace.resetsAt, remaining: 100.0)
        return [start] + decline(from: start, until: pace.resetsAt) + [refill] + decline(from: refill, until: end)
    }
    /// Runs of observed bins, each drawn as its own line. A run bridges short stretches without a fetch,
    /// since refreshes are sparser than bins, and breaks at an unknown bin or a gap longer than an hour.
    private func observedSegments(_ chart: QuotaHistoryChart) -> [[QuotaHistoryBin]] {
        let maxGap = max(3_600, Double(chart.binSeconds) * 2)
        var segments: [[QuotaHistoryBin]] = []
        var previous: QuotaHistoryBin?
        for bin in chart.bins {
            defer { previous = bin }
            guard bin.latest.remainingPercent != nil else { continue }
            if let previous, previous.latest.remainingPercent != nil, bin.startAt.timeIntervalSince(previous.endAt) <= maxGap {
                segments[segments.count - 1].append(bin)
            } else {
                segments.append([bin])
            }
        }
        return segments
    }
    private func resetBand(_ event: QuotaHistoryEvent, chart: QuotaHistoryChart) -> ClosedRange<Date> {
        let width = max(event.toAt.timeIntervalSince(event.fromAt), Double(chart.binSeconds) * 4)
        let center = event.fromAt.addingTimeInterval(event.toAt.timeIntervalSince(event.fromAt) / 2)
        return max(chart.startAt, center.addingTimeInterval(-width / 2))...min(chart.endAt, center.addingTimeInterval(width / 2))
    }
    private func tooltip(_ bin: QuotaHistoryBin) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(time(bin.latest.fetchedAt)).font(.caption2).foregroundStyle(.secondary)
            Text(valueText(bin.latest)).font(.callout.weight(.semibold)).monospacedDigit()
            Text(confidenceText(bin.latest)).font(.caption2).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Color(nsColor: .windowBackgroundColor)).shadow(color: .black.opacity(0.12), radius: 4, y: 1))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(Color.primary.opacity(0.1), lineWidth: 0.5))
    }
    private func midpoint(_ bin: QuotaHistoryBin) -> Date { bin.startAt.addingTimeInterval(bin.endAt.timeIntervalSince(bin.startAt) / 2) }
    private func select(_ location: CGPoint, proxy: ChartProxy, geometry: GeometryProxy) -> Bool {
        guard let frame = proxy.plotFrame else { return false }
        let rect = geometry[frame]
        guard rect.contains(location), let time: Date = proxy.value(atX: location.x - rect.minX),
              model.chart?.bins.contains(where: { time >= $0.startAt && time < $0.endAt }) == true else { return false }
        model.select(at: time)
        return true
    }

    private func legend(_ chart: QuotaHistoryChart) -> some View {
        let tint = meter?.color ?? helper.statusColor(remainingPercent: chart.latest?.remainingPercent ?? 100)
        let observed = legendItem("history.legend.observed") { legendLine(tint, dash: []) }
        let projection = meter == nil ? nil : legendItem("quota.legend.projection") { legendLine(tint, dash: [3, 2]) }
        let unknown = chart.bins.contains(where: { $0.latest.remainingPercent == nil })
            ? legendItem("history.legend.unknown") { Rectangle().fill(.secondary).frame(width: 6, height: 6) } : nil
        let boundary = boundaries.isEmpty ? nil : legendItem("history.legend.boundary") {
            Path { $0.move(to: CGPoint(x: 0, y: 5)); $0.addLine(to: CGPoint(x: 12, y: 5)) }
                .stroke(.secondary, style: StrokeStyle(lineWidth: 1, dash: [3, 2])).frame(width: 12, height: 10)
        }
        let reset = inferredResets.isEmpty ? nil : legendItem("history.legend.reset") {
            RoundedRectangle(cornerRadius: 2).fill(Color.accentColor.opacity(0.25)).frame(width: 12, height: 10)
        }
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 14) { observed; projection; unknown; boundary; reset; Spacer(minLength: 0) }
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 14) { observed; projection; unknown }
                HStack(spacing: 14) { boundary; reset }
            }
        }
        .font(.caption2).foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
    }
    private func legendLine(_ color: Color, dash: [CGFloat]) -> some View {
        Path { $0.move(to: CGPoint(x: 0, y: 5)); $0.addLine(to: CGPoint(x: 12, y: 5)) }
            .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: dash)).frame(width: 12, height: 10)
    }
    private func legendItem(_ key: String, @ViewBuilder symbol: () -> some View) -> some View {
        HStack(spacing: 5) { symbol(); Text(key.localized()).lineLimit(1) }
    }

    private func detail(_ bin: QuotaHistoryBin) -> some View {
        let rows = detailRows(bin)
        let split = (rows.count + 1) / 2
        return VStack(alignment: .leading, spacing: 10) {
            Text("history.selection".localized()).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 24) {
                    detailGrid(Array(rows[..<split])).fixedSize()
                    detailGrid(Array(rows[split...])).fixedSize()
                    Spacer(minLength: 0)
                }
                detailGrid(rows)
            }
            ForEach(model.selectedEvents) { event in eventRow(event) }
            if model.nextCursor != nil {
                Text("history.moreEventsHelp".localized()).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .textSelection(.enabled)
    }
    private func detailRows(_ bin: QuotaHistoryBin) -> [(String, String)] {
        var rows = [("history.observedAt", time(bin.latest.fetchedAt)), (levelKey, valueText(bin.latest))]
        if let minimum = bin.minRemainingPercent, let maximum = bin.maxRemainingPercent {
            let low = displayMode == .remaining ? minimum : maximum
            let high = displayMode == .remaining ? maximum : minimum
            rows.append(("history.binExtrema", percentage(low) + " – " + percentage(high)))
        }
        rows += [("history.samples", bin.sampleCount.formatted()), ("history.confidence", confidenceText(bin.latest)),
                 ("history.source", bin.latest.source),
                 ("history.states", bin.states.map { ("history.state." + $0.rawValue).localized() }.joined(separator: ", "))]
        if let reset = resetText(bin.latest) { rows.append(("history.expectedReset", reset)) }
        return rows
    }
    private func detailGrid(_ rows: [(String, String)]) -> some View {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 5) {
            ForEach(rows, id: \.0) { key, value in
                GridRow {
                    Text(key.localized()).foregroundStyle(.secondary)
                    Text(value).monospacedDigit()
                }
            }
        }
        .font(.caption)
    }
    private func resetText(_ observation: QuotaHistoryObservation) -> String? {
        observation.resetsAt.map(time) ?? observation.resetDescription
    }

    private func amounts(_ chart: QuotaHistoryChart) -> some View {
        card {
            Label { Text("history.amountOnly".localized()).fixedSize(horizontal: false, vertical: true) } icon: { Image(systemName: "number") }
                .font(.callout).foregroundStyle(.secondary)
            Picker("history.observedAt".localized(), selection: Binding(get: { model.selectedBinID ?? chart.bins.last!.id }, set: { model.selectedBinID = $0 })) {
                ForEach(chart.bins) { bin in Text(time(bin.latest.fetchedAt) + " — " + valueText(bin.latest)).tag(bin.id) }
            }
            if let bin = model.selectedBin {
                Divider()
                detail(bin)
            }
        }
    }

    private var eventList: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 8) {
                if model.events.isEmpty { Text("history.noEvents".localized()).foregroundStyle(.secondary) }
                ForEach(model.events) { event in eventRow(event) }
                if model.eventError != nil {
                    Label("history.eventsFailed".localized(), systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
                }
                if model.nextCursor != nil {
                    HStack(spacing: 8) {
                        Button("history.moreEvents".localized()) { model.loadMoreEvents() }
                            .controlSize(.small)
                            .disabled(model.isLoadingEvents || !model.availability.connected)
                        if model.isLoadingEvents { ProgressView().controlSize(.small) }
                    }
                }
            }
            .font(.caption).padding(.top, 8).textSelection(.enabled)
        } label: {
            Text("history.events".localized()).font(.subheadline.weight(.medium))
        }
    }
    private func eventRow(_ event: QuotaHistoryEvent) -> some View {
        Label {
            Text(eventText(event)).fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
        } icon: {
            Image(systemName: eventSymbol(event.kind)).foregroundStyle(eventTint(event.kind))
        }
        .font(.caption)
    }
    private func eventSymbol(_ kind: QuotaHistoryEventKind) -> String {
        switch kind {
        case .resetInferred: "arrow.counterclockwise"
        case .quotaIncreased: "arrow.up.right"
        case .basisChanged: "rectangle.split.2x1"
        case .clockChanged: "clock.badge.exclamationmark"
        }
    }
    private func eventTint(_ kind: QuotaHistoryEventKind) -> Color {
        switch kind {
        case .resetInferred: .accentColor
        case .quotaIncreased: .green
        case .basisChanged: .secondary
        case .clockChanged: .orange
        }
    }

    private func percentage(_ value: Double) -> String { helper.displayPercent(remainingPercent: value).formatted(.number.precision(.fractionLength(0...1))) + "%" }
    private func valueText(_ observation: QuotaHistoryObservation) -> String {
        if let remaining = observation.remainingPercent { return percentage(remaining) }
        if let amount = observation.amount { return amount.formatted() + " " + (observation.unit ?? "") }
        return ("history.state." + observation.state.rawValue).localized()
    }
    private func confidenceText(_ observation: QuotaHistoryObservation) -> String { ("history.confidence." + observation.confidence.rawValue).localized() }
    private func time(_ date: Date) -> String { date.formatted(date: .abbreviated, time: .shortened) }
    private func accessibilityDetail(_ bin: QuotaHistoryBin) -> String {
        [time(bin.latest.fetchedAt), valueText(bin.latest), confidenceText(bin.latest), model.selectedEvents.map(eventText).joined(separator: ". ")].joined(separator: ", ")
    }
    private func eventText(_ event: QuotaHistoryEvent) -> String {
        switch event.kind {
        case .resetInferred:
            String(format: "history.event.reset".localized(), time(event.fromAt), time(event.toAt))
        case .quotaIncreased:
            "history.event.increased".localized() + " · " + time(event.fromAt) + " – " + time(event.toAt)
        case .basisChanged:
            "history.event.basis".localized() + " · " + time(event.toAt)
        case .clockChanged:
            "history.event.clock".localized() + " · " + time(event.fromAt) + " – " + time(event.toAt)
        }
    }
}
