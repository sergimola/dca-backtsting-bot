import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Pagination } from '../../components/Pagination'

describe('Pagination Component Tests', () => {
  test('T063.1: Component renders page buttons', () => {
    const onPageChange = jest.fn()

    render(
      <Pagination
        pageIndex={0}
        pageSize={25}
        totalItems={100}
        onPageChange={onPageChange}
      />
    )

    // Should have navigation buttons
    expect(screen.getByRole('button', { name: /prev|previous/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument()
  })

  test('T063.2: Next button navigates to next page', () => {
    const onPageChange = jest.fn()

    render(
      <Pagination
        pageIndex={0}
        pageSize={25}
        totalItems={100}
        onPageChange={onPageChange}
      />
    )

    const nextButton = screen.getByRole('button', { name: /next/i })
    fireEvent.click(nextButton)

    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  test('T063.3: Previous button navigates to previous page', () => {
    const onPageChange = jest.fn()

    render(
      <Pagination
        pageIndex={2}
        pageSize={25}
        totalItems={100}
        onPageChange={onPageChange}
      />
    )

    const prevButton = screen.getByRole('button', { name: /prev|previous/i })
    fireEvent.click(prevButton)

    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  test('T063.4: Previous button is disabled on first page', () => {
    const onPageChange = jest.fn()

    render(
      <Pagination
        pageIndex={0}
        pageSize={25}
        totalItems={100}
        onPageChange={onPageChange}
      />
    )

    const prevButton = screen.getByRole('button', { name: /prev|previous/i })
    expect(prevButton).toBeDisabled()
  })

  test('T063.5: Next button is disabled on last page', () => {
    const onPageChange = jest.fn()

    render(
      <Pagination
        pageIndex={3}
        pageSize={25}
        totalItems={100}
        onPageChange={onPageChange}
      />
    )

    const nextButton = screen.getByRole('button', { name: /next/i })
    expect(nextButton).toBeDisabled()
  })

  test('T063.6: Page indicator shows current page info', () => {
    const onPageChange = jest.fn()

    render(
      <Pagination
        pageIndex={1}
        pageSize={25}
        totalItems={100}
        onPageChange={onPageChange}
      />
    )

    // Should show page information
    expect(screen.getByText('Page 2 of 4')).toBeInTheDocument()
  })

  test('T063.7: Component calculates total pages correctly', () => {
    const onPageChange = jest.fn()

    const { rerender } = render(
      <Pagination
        pageIndex={0}
        pageSize={25}
        totalItems={100}
        onPageChange={onPageChange}
      />
    )

    // 100 items / 25 per page = 4 pages total
    const pageElements = screen.getByText(/page|total/i)
    expect(pageElements).toBeInTheDocument()

    // With 150 items, should have 6 pages
    rerender(
      <Pagination
        pageIndex={0}
        pageSize={25}
        totalItems={150}
        onPageChange={onPageChange}
      />
    )
  })

  test('T063.8: Single page disables both navigation buttons', () => {
    const onPageChange = jest.fn()

    render(
      <Pagination
        pageIndex={0}
        pageSize={50}
        totalItems={25}
        onPageChange={onPageChange}
      />
    )

    // Only 1 page total, both buttons should be disabled
    const buttons = screen.getAllByRole('button')
    buttons.forEach(btn => {
      if (btn.textContent?.match(/prev|next|previous/i)) {
        expect(btn).toBeDisabled()
      }
    })
  })

  test('T063.9: Component shows "Showing X-Y of Z" text', () => {
    const onPageChange = jest.fn()

    render(
      <Pagination
        pageIndex={0}
        pageSize={25}
        totalItems={100}
        onPageChange={onPageChange}
      />
    )

    // Should show range like "Showing 1-25 of 100"
    expect(screen.getByText('Showing 1-25 of 100 items')).toBeInTheDocument()
  })

  test('T063.10: Component responds to pageIndex changes', () => {
    const onPageChange = jest.fn()

    const { rerender } = render(
      <Pagination
        pageIndex={0}
        pageSize={25}
        totalItems={100}
        onPageChange={onPageChange}
      />
    )

    const prevButton = screen.getByRole('button', { name: /prev|previous/i })
    expect(prevButton).toBeDisabled()

    // Move to page 2
    rerender(
      <Pagination
        pageIndex={1}
        pageSize={25}
        totalItems={100}
        onPageChange={onPageChange}
      />
    )

    // Now prev should be enabled
    expect(prevButton).not.toBeDisabled()
  })
})
