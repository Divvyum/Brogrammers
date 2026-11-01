import type { EventContent } from '@hackos/shared'
import { useEventInfo } from './lib/data'

/**
 * Event copy the organizers edit in the admin app (Overview → Participant
 * page): venue, tagline, help contacts, rules, prizes, alumni and the venue
 * map. Empty until they fill it in.
 */
export const emptyContent: EventContent = {
  venue: '',
  tagline: '',
  rulesUrl: '',
  helpPhone: '',
  whatsappNumber: '',
  rules: [],
  prizes: [],
  alumni: [],
  map: { imageUrl: '', markers: [] },
}

export function useContent(): EventContent {
  const { data } = useEventInfo()
  return { ...emptyContent, ...data?.content }
}
