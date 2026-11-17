import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'

describe('App smoke test', () => {
  it('should_open_on_the_library (spec 0013 AC-1)', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Peel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New sticker' })).toBeVisible()
  })

  it('should_offer_to_pick_a_photo (spec 0013 AC-3)', () => {
    render(<App />)
    expect(screen.getByLabelText('Pick a photo')).toBeInTheDocument()
  })
})
