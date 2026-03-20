<script lang="ts">
  import type { MetricStats } from "$lib/types";
  import { formatGigabyteValue } from "$lib/utils/format";

  type Props = {
    idSuffix: string;
    title: string;
    tone: "cpu" | "memory";
    stats: MetricStats | null;
    unit?: "percent" | "gigabytes";
    ceiling?: number | null;
    loading?: boolean;
    error?: string | null;
    compact?: boolean;
  };

  let {
    idSuffix,
    title,
    tone,
    stats,
    unit = "percent",
    ceiling = null,
    loading = false,
    error = null,
    compact = false,
  }: Props = $props();

  const width = 260;
  const height = 76;
  const padding = 8;
  let titleId = $derived(
    `metric-chart-${title.toLowerCase().replaceAll(/\s+/g, "-")}-${idSuffix}`,
  );

  function yForValue(value: number, max: number) {
    const normalizedValue = Math.min(max, Math.max(0, value));
    return height - padding - (normalizedValue / max) * (height - padding * 2);
  }

  let plottedPoints = $derived.by(() => {
    const points = stats?.points ?? [];
    if (points.length <= 2) {
      return points;
    }

    const firstNonZeroIndex = points.findIndex((point) => point.value > 0.1);
    if (firstNonZeroIndex <= 1) {
      return points;
    }

    return points.slice(firstNonZeroIndex - 1);
  });

  let path = $derived.by(() => {
    const points = plottedPoints;
    if (!points.length) {
      return "";
    }

    const maxValue =
      unit === "percent"
        ? 100
        : Math.max(
            ceiling ?? Math.max(...points.map((point) => point.value), 0),
            1,
          );

    return points
      .map((point, index) => {
        const x =
          padding +
          (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
        const y = yForValue(point.value, maxValue);

        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  });

  let gridValues = $derived.by(() => {
    if (unit === "percent") {
      return [20, 40, 60, 80, 100];
    }

    const maxValue = Math.max(ceiling ?? 0, 1);
    const wholeGigabytes = Math.floor(maxValue);
    const values = Array.from(
      { length: wholeGigabytes },
      (_, index) => index + 1,
    );

    if (values.at(-1) !== maxValue) {
      values.push(maxValue);
    }

    return values;
  });

  function formatMetric(value: number | null) {
    if (value === null || Number.isNaN(value)) {
      return "—";
    }

    if (unit === "gigabytes") {
      return `${formatGigabyteValue(value)} GB`;
    }

    return `${value.toFixed(1)}%`;
  }

  function formatUsageSummary(current: number | null, max: number | null) {
    if (
      current === null ||
      max === null ||
      Number.isNaN(current) ||
      Number.isNaN(max) ||
      max <= 0
    ) {
      return "—";
    }

    const percent = (current / max) * 100;
    return `${formatGigabyteValue(current)} / ${formatGigabyteValue(max)} GB (${percent.toFixed(0)}%)`;
  }
</script>

<section class="metric {tone}" class:compact>
  <div class="head">
    <p>{title}</p>
    {#if unit === 'gigabytes' && ceiling !== null}
      <strong>{formatUsageSummary(stats?.current ?? null, ceiling)}</strong>
    {:else if stats?.current !== null}
      <strong>{formatMetric(stats?.current ?? null)}</strong>
    {/if}
  </div>

  {#if loading}
    <div class="placeholder">Loading {title.toLowerCase()} chart...</div>
  {:else if error}
    <div class="placeholder error">{error}</div>
  {:else if !plottedPoints.length}
    <div class="placeholder">No chart data</div>
  {:else}
    <svg
      aria-labelledby={titleId}
      class="chart"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <title id={titleId}>{title}</title>
      {#each gridValues as gridValue (gridValue)}
        <line
          class="grid"
          x1={padding}
          x2={width - padding}
          y1={yForValue(gridValue, unit === 'percent' ? 100 : Math.max(ceiling ?? 0, 1))}
          y2={yForValue(gridValue, unit === 'percent' ? 100 : Math.max(ceiling ?? 0, 1))}
        ></line>
      {/each}
      <path class="line" d={path}></path>
    </svg>

    <div class="summary">
      <div>
        <span>Avg</span>
        <strong>{formatMetric(stats?.average ?? null)}</strong>
      </div>
      <div>
        <span>Peak</span>
        <strong>{formatMetric(stats?.peak ?? null)}</strong>
      </div>
    </div>
  {/if}
</section>

<style>
  .metric {
    display: grid;
    gap: 0.75rem;
    padding: 0.9rem;
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.04);
  }

  .metric.compact {
    gap: 0.65rem;
    padding: 0.8rem;
  }

  .head,
  .summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .head p,
  .head strong {
    margin: 0;
  }

  .head p {
    font-size: 0.84rem;
    color: rgba(209, 221, 231, 0.82);
  }

  .head strong {
    font:
      700 0.9rem / 1 "IBM Plex Mono",
      "SFMono-Regular",
      Consolas,
      monospace;
  }

  .metric.compact .head p {
    font-size: 0.8rem;
  }

  .metric.compact .head strong {
    font-size: 0.82rem;
  }

  .metric.memory.compact .head strong {
    text-align: end;
  }

  .chart {
    width: 100%;
    height: auto;
    display: block;
  }

  .grid {
    stroke: rgba(255, 255, 255, 0.1);
    stroke-width: 1;
  }

  .line {
    fill: none;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .cpu .line {
    stroke: #f8b84b;
  }

  .memory .line {
    stroke: #7de7f3;
  }

  .summary > div {
    display: grid;
    gap: 0.2rem;
  }

  .summary span {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(185, 203, 218, 0.64);
  }

  .summary strong {
    color: #f5f9fb;
  }

  .metric.compact .summary span {
    font-size: 0.68rem;
  }

  .placeholder {
    padding: 1rem 0.9rem;
    border-radius: 0.9rem;
    background: rgba(255, 255, 255, 0.04);
    color: rgba(222, 231, 237, 0.8);
  }

  .placeholder.error {
    background: rgba(255, 109, 91, 0.1);
    color: #ffbdb3;
  }
</style>
