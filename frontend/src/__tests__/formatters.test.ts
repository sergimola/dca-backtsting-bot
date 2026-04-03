import { msDuration } from '../services/formatters'

describe('msDuration', () => {
  it('formats 180_000_000ms as "2d 2h 0m"', () => {
    expect(msDuration(180_000_000)).toBe('2d 2h 0m')
  })

  it('formats 3_600_000ms as "1h 0m"', () => {
    expect(msDuration(3_600_000)).toBe('1h 0m')
  })

  it('formats 59_000ms as "0m"', () => {
    expect(msDuration(59_000)).toBe('0m')
  })

  it('formats 0ms as "0m"', () => {
    expect(msDuration(0)).toBe('0m')
  })

  it('formats 90_060_000ms as "1d 1h 1m"', () => {
    expect(msDuration(90_060_000)).toBe('1d 1h 1m')
  })
})
