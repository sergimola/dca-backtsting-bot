import React, { useState, useMemo } from 'react'
import { Pagination } from './Pagination'
import { formatCurrency, formatCryptoQuantity } from '../services/formatters'
import type { TradeEvent } from '../services/types'

export interface TradeEventsTableProps {
  events: TradeEvent[]
}

type SortField = 'timestamp' | 'eventType' | 'price' | 'quantity' | 'balance'

export function TradeEventsTable({ events }: TradeEventsTableProps) {
  const [sortField, setSortField] = useState<SortField>('timestamp')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [pageIndex, setPageIndex] = useState(0)
  const pageSize = 25

  // Handle column header click for sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Toggle sort order if clicking same field
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      // New field, default to ascending
      setSortField(field)
      setSortOrder('asc')
    }
  }

  // Sort and paginate events
  const sortedAndPaginatedEvents = useMemo(() => {
    // Sort events
    const sorted = [...events].sort((a, b) => {
      let aVal: any = a[sortField]
      let bVal: any = b[sortField]

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase()
        bVal = (bVal as string).toLowerCase()
      }

      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
      return sortOrder === 'asc' ? comparison : -comparison
    })

    // Paginate
    const start = pageIndex * pageSize
    const end = start + pageSize
    return sorted.slice(start, end)
  }, [events, sortField, sortOrder, pageIndex])

  const renderSortIndicator = (field: SortField) => {
    if (sortField !== field) return ''
    return sortOrder === 'asc' ? ' ↑' : ' ↓'
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse border border-gray-300">
          <thead className="bg-gray-100">
            <tr>
              <th
                onClick={() => handleSort('timestamp')}
                className="border border-gray-300 px-4 py-2 text-left cursor-pointer hover:bg-gray-200 font-semibold"
              >
                Timestamp{renderSortIndicator('timestamp')}
              </th>
              <th
                onClick={() => handleSort('eventType')}
                className="border border-gray-300 px-4 py-2 text-left cursor-pointer hover:bg-gray-200 font-semibold"
              >
                Event Type{renderSortIndicator('eventType')}
              </th>
              <th
                onClick={() => handleSort('price')}
                className="border border-gray-300 px-4 py-2 text-right cursor-pointer hover:bg-gray-200 font-semibold"
              >
                Price{renderSortIndicator('price')}
              </th>
              <th
                onClick={() => handleSort('quantity')}
                className="border border-gray-300 px-4 py-2 text-right cursor-pointer hover:bg-gray-200 font-semibold"
              >
                Quantity{renderSortIndicator('quantity')}
              </th>
              <th
                onClick={() => handleSort('balance')}
                className="border border-gray-300 px-4 py-2 text-right cursor-pointer hover:bg-gray-200 font-semibold"
              >
                Balance{renderSortIndicator('balance')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedAndPaginatedEvents.length > 0 ? (
              sortedAndPaginatedEvents.map((event, idx) => (
                <tr key={`${event.timestamp}-${idx}`} className="hover:bg-gray-50">
                  <td className="border border-gray-300 px-4 py-2 text-sm">
                    {event.timestamp}
                  </td>
                  <td className="border border-gray-300 px-4 py-2 text-sm capitalize">
                    {event.eventType}
                  </td>
                  <td className="border border-gray-300 px-4 py-2 text-sm text-right">
                    {formatCryptoQuantity(event.price, 8)}
                  </td>
                  <td className="border border-gray-300 px-4 py-2 text-sm text-right">
                    {formatCryptoQuantity(event.quantity, 8)}
                  </td>
                  <td className="border border-gray-300 px-4 py-2 text-sm text-right">
                    {formatCurrency(event.balance, 2)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="border border-gray-300 px-4 py-2 text-center text-gray-500">
                  No trade events
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {events.length > 0 && (
        <Pagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          totalItems={events.length}
          onPageChange={setPageIndex}
        />
      )}
    </div>
  )
}
