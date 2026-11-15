import { describe, expect, it } from 'vitest'
import { MAX_SIMULADORES, simuladorPara } from '../src/services/simulador'

describe('simulador del MH: memoria acotada', () => {
  it('el mapa de simuladores no crece sin límite y descarta el menos usado', () => {
    const primero = simuladorPara('06140000000001', 'clave-0')
    for (let i = 1; i <= MAX_SIMULADORES + 5; i++) simuladorPara('06140000000001', `clave-${i}`)
    expect(simuladorPara('06140000000001', 'clave-0')).not.toBe(primero) // fue expulsado
    const reciente = simuladorPara('06140000000001', `clave-${MAX_SIMULADORES + 5}`)
    expect(simuladorPara('06140000000001', `clave-${MAX_SIMULADORES + 5}`)).toBe(reciente)
  })
})
