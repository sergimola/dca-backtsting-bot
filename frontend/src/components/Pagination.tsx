import React from 'react'

export interface PaginationProps {
  pageIndex: number
  pageSize: number
  totalItems: number
  onPageChange: (newPageIndex: number) => void
}

export function Pagination({ pageIndex, pageSize, totalItems, onPageChange }: PaginationProps) {
  const totalPages = Math.ceil(totalItems / pageSize)
  const startItem = pageIndex * pageSize + 1
  const endItem = Math.min((pageIndex + 1) * pageSize, totalItems)
  
  const isPrevDisabled = pageIndex === 0
  const isNextDisabled = pageIndex >= totalPages - 1

  return (
    <div className="flex items-center justify-between py-4">
      <div className="text-sm text-gray-600">
        Showing {startItem}-{endItem} of {totalItems} items
      </div>
      
      <div className="flex gap-2">
        <button
          onClick={() => onPageChange(Math.max(0, pageIndex - 1))}
          disabled={isPrevDisabled}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        
        <span className="px-4 py-2 flex items-center">
          Page {pageIndex + 1} of {Math.max(1, totalPages)}
        </span>
        
        <button
          onClick={() => onPageChange(Math.min(totalPages - 1, pageIndex + 1))}
          disabled={isNextDisabled}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  )
}
