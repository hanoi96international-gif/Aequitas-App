import type { Catalog } from './de';

// Must stay complete (type-checked against the German source).
const en: Catalog = {
  common: {
    appName: 'Aequitas',
    continue: 'Continue',
    cancel: 'Cancel',
    confirm: 'Confirm',
    done: 'Done',
    retry: 'Try again',
    close: 'Close',
    copy: 'Copy',
    copied: 'Copied',
    share: 'Share',
    loading: 'Loading …',
    unknown: 'Unknown',
  },
  errors: {
    network: {
      title: 'No connection',
      message: 'Check your internet connection. We will retry automatically.',
    },
    timeout: {
      title: 'Timed out',
      message: 'The server did not answer in time.',
    },
    rateLimited: {
      title: 'Please wait',
      message: 'Many requests at once. Next attempt in {seconds} s.',
    },
    unavailable: {
      title: 'Temporarily unavailable',
      message: 'The network is busy right now. Please try again shortly.',
    },
    rejected: {
      title: 'Rejected',
      message: '{reason}',
    },
    invalidResponse: {
      title: 'Unexpected response',
      message: 'The server sent something the app does not understand.',
    },
    chainMismatch: {
      title: 'Wrong network',
      message: 'This node does not belong to the Aequitas network. For your safety nothing will be signed.',
    },
    clockSkew: {
      title: 'Clock is off',
      message: "Your device clock is off by {seconds} s. Please enable automatic time.",
    },
    netzGewechselt: {
      title: 'The network was restarted',
      message: 'Aequitas has restarted. Earlier registrations and balances no longer apply – please register again.',
    },
  },
  offline: {
    banner: 'Offline – showing the last known state ({time}).',
  },
  time: {
    secondsAgo: { one: '{count} second ago', other: '{count} seconds ago' },
    minutesAgo: { one: '{count} minute ago', other: '{count} minutes ago' },
  },
};

export default en;
