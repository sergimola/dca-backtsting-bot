// Jest setup file for testing library
import '@testing-library/jest-dom'

// Mock ResizeObserver for Recharts compatibility in JSDOM
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}))
