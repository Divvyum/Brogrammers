import { useSyncExternalStore } from 'react'
import { hi as hiText } from './hi'

/**
 * Hindi/English (build plan S15). Navigation and shared UI use keys: t('key').
 * Every other screen string is written in English and wrapped in tr('…'); its
 * Hindi lives in ./hi.ts under the same English text (English is the fallback).
 */
const en = {
  'nav.overview': 'Overview',
  'nav.prepare': 'Prepare',
  'nav.hackathon': 'Hackathon',
  'nav.after': 'After the event',
  'nav.home': 'Home',
  'nav.event': 'Event & Registration',
  'nav.team': 'Team',
  'nav.journey': 'JourneyLink',
  'nav.myid': 'My ID',
  'nav.schedule': 'Schedule',
  'nav.announcements': 'Announcements',
  'nav.problems': 'Problem Statements',
  'nav.mentors': 'Mentors',
  'nav.eventday': 'Event Day',
  'nav.submission': 'Submission',
  'nav.results': 'Results',
  'nav.rewards': 'Rewards',
  'nav.rating': 'Rate the Event',
  'nav.community': 'Community',
  'nav.profile': 'Profile & Settings',
  'nav.more': 'More',
  'home.welcome': 'Welcome back',
  'home.subtitle': 'Here is where you are in your hackathon journey.',
  'home.next': 'Your next step',
  'home.journey': 'Your journey',
  'common.offline': 'You are offline. Your ID card, schedule and saved pages still work. Changes need a connection.',
  'common.search': 'Search pages, schedule, announcements…',
  'common.signout': 'Sign out',
  'common.theme': 'Dark theme',
  'common.language': 'Language',
}

type Key = keyof typeof en
const hi: Record<Key, string> = {
  'nav.overview': 'अवलोकन',
  'nav.prepare': 'तैयारी',
  'nav.hackathon': 'हैकाथॉन',
  'nav.after': 'इवेंट के बाद',
  'nav.home': 'होम',
  'nav.event': 'इवेंट और पंजीकरण',
  'nav.team': 'टीम',
  'nav.journey': 'जर्नीलिंक',
  'nav.myid': 'मेरी आईडी',
  'nav.schedule': 'कार्यक्रम',
  'nav.announcements': 'घोषणाएँ',
  'nav.problems': 'समस्या कथन',
  'nav.mentors': 'मेंटर',
  'nav.eventday': 'इवेंट का दिन',
  'nav.submission': 'सबमिशन',
  'nav.results': 'परिणाम',
  'nav.rewards': 'पुरस्कार',
  'nav.rating': 'इवेंट को रेट करें',
  'nav.community': 'समुदाय',
  'nav.profile': 'प्रोफ़ाइल और सेटिंग्स',
  'nav.more': 'और',
  'home.welcome': 'फिर से स्वागत है',
  'home.subtitle': 'आपकी हैकाथॉन यात्रा यहाँ तक पहुँची है।',
  'home.next': 'आपका अगला कदम',
  'home.journey': 'आपकी यात्रा',
  'common.offline': 'आप ऑफ़लाइन हैं। आपका आईडी कार्ड, कार्यक्रम और सेव किए गए पेज अब भी काम करते हैं। बदलाव के लिए इंटरनेट चाहिए।',
  'common.search': 'पेज, कार्यक्रम, घोषणाएँ खोजें…',
  'common.signout': 'साइन आउट',
  'common.theme': 'डार्क थीम',
  'common.language': 'भाषा',
}

export type Lang = 'en' | 'hi'
const dict: Record<Lang, Record<Key, string>> = { en, hi }
let lang: Lang = (() => { try { return (localStorage.getItem('aura-lang') as Lang) || 'en' } catch { return 'en' } })()
const listeners = new Set<() => void>()

export function setLang(l: Lang) {
  if (l === lang) return
  lang = l
  try { localStorage.setItem('aura-lang', l) } catch { /* ignore */ }
  document.documentElement.lang = l
  listeners.forEach((f) => f())
  // Reload so text built outside components (lists, defaults) is translated too.
  window.location.reload()
}

export const currentLang = () => lang

/** The screen text in the current language. `text` is the English original. */
export function tr(text: string): string {
  return lang === 'hi' ? (hiText[text] ?? text) : text
}

export function useLang() {
  const current = useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f) }, () => lang)
  return { lang: current, setLang, t: (k: Key) => dict[current][k] }
}
export type StringKey = Key
