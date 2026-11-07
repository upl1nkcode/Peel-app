import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'

describe('App smoke test', () => {
  it('should_render_the_app_title', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Peel' })).toBeInTheDocument()
  })

  it('should_offer_to_pick_a_photo (AC-24)', () => {
    render(<App />)
    expect(screen.getByLabelText('Pick a photo')).toBeInTheDocument()
  })
})
