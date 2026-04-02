// Jest setup file for testing library
import '@testing-library/jest-dom'
import { TextEncoder, TextDecoder } from 'util'
import { ReadableStream, TransformStream } from 'stream/web'

// Polyfill TextEncoder/TextDecoder/ReadableStream which jsdom does not provide.
if (typeof globalThis.TextEncoder === 'undefined') {
  ;(globalThis as unknown as Record<string, unknown>).TextEncoder = TextEncoder
  ;(globalThis as unknown as Record<string, unknown>).TextDecoder = TextDecoder
}
if (typeof globalThis.ReadableStream === 'undefined') {
  ;(globalThis as unknown as Record<string, unknown>).ReadableStream = ReadableStream
  ;(globalThis as unknown as Record<string, unknown>).TransformStream = TransformStream
}

// Mock ResizeObserver for Recharts compatibility in JSDOM
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}))
