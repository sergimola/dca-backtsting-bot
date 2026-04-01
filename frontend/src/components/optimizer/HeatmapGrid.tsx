/**
 * HeatmapGrid — Pure SVG heatmap with HSL color mapping (red → green),
 * axis selectors for 3+ swept vars, tooltip on hover.
 */
import React, { useMemo, useState } from 'react'
import type { EnrichedResult } from '../../hooks/useOptimizer'

interface Props {
  results: EnrichedResult[]
  sweptParams: string[]
}

const CELL = 40
const MARGIN = { top: 30, right: 20, bottom: 60, left: 80 }

function pnlToHue(pnl: number, min: number, max: number): number {
  if (max === min) return 60
  const t = (pnl - min) / (max - min) // 0..1
  return t * 120 // 0=red, 60=yellow, 120=green
}

export function HeatmapGrid({ results, sweptParams }: Props) {
  const [xAxis, setXAxis] = useState(sweptParams[0] ?? '')
  const [yAxis, setYAxis] = useState(sweptParams[1] ?? '')
  const [tooltip, setTooltip] = useState<{ x: number; y: number; result: EnrichedResult } | null>(null)

  const { grid, xLabels, yLabels, pnlMin, pnlMax } = useMemo(() => {
    if (!xAxis || !yAxis || results.length === 0) {
      return { grid: new Map<string, EnrichedResult>(), xLabels: [] as string[], yLabels: [] as string[], pnlMin: 0, pnlMax: 0 }
    }
    const xSet = new Set<string>()
    const ySet = new Set<string>()
    const map = new Map<string, EnrichedResult>()
    let minP = Infinity, maxP = -Infinity

    for (const r of results) {
      const xVal = String(r.config[xAxis] ?? '')
      const yVal = String(r.config[yAxis] ?? '')
      xSet.add(xVal)
      ySet.add(yVal)
      const pnl = r.pnlSummary?.roi ?? 0
      if (pnl < minP) minP = pnl
      if (pnl > maxP) maxP = pnl
      const key = `${xVal}|${yVal}`
      const existing = map.get(key)
      if (!existing || pnl > (existing.pnlSummary?.roi ?? 0)) {
        map.set(key, r)
      }
    }

    const sortNum = (a: string, b: string) => Number(a) - Number(b)
    return {
      grid: map,
      xLabels: Array.from(xSet).sort(sortNum),
      yLabels: Array.from(ySet).sort(sortNum),
      pnlMin: minP === Infinity ? 0 : minP,
      pnlMax: maxP === -Infinity ? 0 : maxP,
    }
  }, [results, xAxis, yAxis])

  if (sweptParams.length < 2) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-slate-500">
        Heatmap requires at least 2 swept parameters
      </div>
    )
  }

  const width = MARGIN.left + xLabels.length * CELL + MARGIN.right
  const height = MARGIN.top + yLabels.length * CELL + MARGIN.bottom

  return (
    <div className="space-y-2">
      {/* Axis selectors */}
      {sweptParams.length > 2 && (
        <div className="flex gap-4 text-xs text-slate-400">
          <label>
            X-Axis:{' '}
            <select value={xAxis} onChange={e => setXAxis(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-slate-200">
              {sweptParams.filter(p => p !== yAxis).map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>
            Y-Axis:{' '}
            <select value={yAxis} onChange={e => setYAxis(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-slate-200">
              {sweptParams.filter(p => p !== xAxis).map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>
      )}

      {/* SVG grid */}
      <div className="overflow-auto">
        <svg width={width} height={height} className="select-none">
          {/* X labels */}
          {xLabels.map((label, i) => (
            <text
              key={`xl-${label}`}
              x={MARGIN.left + i * CELL + CELL / 2}
              y={height - MARGIN.bottom + 18}
              textAnchor="middle"
              className="fill-slate-400 text-[10px]"
            >
              {label}
            </text>
          ))}
          {/* Y labels */}
          {yLabels.map((label, i) => (
            <text
              key={`yl-${label}`}
              x={MARGIN.left - 8}
              y={MARGIN.top + i * CELL + CELL / 2 + 4}
              textAnchor="end"
              className="fill-slate-400 text-[10px]"
            >
              {label}
            </text>
          ))}
          {/* Axis labels */}
          <text
            x={MARGIN.left + (xLabels.length * CELL) / 2}
            y={height - 8}
            textAnchor="middle"
            className="fill-slate-500 text-[11px] font-medium"
          >
            {xAxis}
          </text>
          <text
            x={14}
            y={MARGIN.top + (yLabels.length * CELL) / 2}
            textAnchor="middle"
            transform={`rotate(-90, 14, ${MARGIN.top + (yLabels.length * CELL) / 2})`}
            className="fill-slate-500 text-[11px] font-medium"
          >
            {yAxis}
          </text>

          {/* Cells */}
          {xLabels.map((xVal, xi) =>
            yLabels.map((yVal, yi) => {
              const r = grid.get(`${xVal}|${yVal}`)
              if (!r) return null
              const pnl = r.pnlSummary?.roi ?? 0
              const hue = pnlToHue(pnl, pnlMin, pnlMax)
              return (
                <rect
                  key={`${xi}-${yi}`}
                  x={MARGIN.left + xi * CELL}
                  y={MARGIN.top + yi * CELL}
                  width={CELL - 1}
                  height={CELL - 1}
                  rx={3}
                  fill={`hsl(${hue}, 70%, 45%)`}
                  className="cursor-pointer"
                  onMouseEnter={e => {
                    const svg = (e.target as SVGElement).closest('svg')!
                    const pt = svg.createSVGPoint()
                    pt.x = e.clientX; pt.y = e.clientY
                    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse())
                    setTooltip({ x: svgP.x, y: svgP.y, result: r })
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              )
            }),
          )}

          {/* Tooltip */}
          {tooltip && (
            <g>
              <rect
                x={tooltip.x + 10}
                y={tooltip.y - 40}
                width={180}
                height={50}
                rx={4}
                fill="rgba(15,23,42,0.95)"
                stroke="#334155"
              />
              <text x={tooltip.x + 18} y={tooltip.y - 22} className="fill-slate-200 text-[10px]">
                ROI: {(tooltip.result.pnlSummary?.roi ?? 0).toFixed(2)}%
              </text>
              <text x={tooltip.x + 18} y={tooltip.y - 8} className="fill-slate-400 text-[10px]">
                {xAxis}: {tooltip.result.config[xAxis]} / {yAxis}: {tooltip.result.config[yAxis]}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  )
}
