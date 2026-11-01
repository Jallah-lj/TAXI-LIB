export type PhoneAction = 'dispatch' | 'vehicles' | 'homes' | 'garage';

export interface PhoneContact {
  id: string;
  name: string;
  role: string;
  number: string;
  lines: string[];
  actionLabel: string;
  action: PhoneAction;
}

export interface PhoneCallSnapshot {
  contact: PhoneContact;
  status: 'connecting' | 'connected';
  elapsedSeconds: number;
  visibleLines: string[];
}

export const PHONE_CONTACTS: readonly PhoneContact[] = Object.freeze([
  {
    id: 'dispatch', name: 'Kendeja Dispatch', role: 'Passenger coordination', number: '+231 77 010 10',
    lines: ['Driver, your cooperative line is active.', 'Current passenger requests are ready in the dispatch panel.'],
    actionLabel: 'Open dispatch', action: 'dispatch',
  },
  {
    id: 'motors', name: 'Seabreeze Motors', role: 'Vehicle sales & delivery', number: '+231 77 020 20',
    lines: ['Welcome to Seabreeze Motors.', 'Browse locally priced vehicles in your garage. Purchased cars are delivered to your parking position when selected.'],
    actionLabel: 'Browse vehicles', action: 'vehicles',
  },
  {
    id: 'homes', name: 'Coastal Homes', role: 'Property sales & upgrades', number: '+231 77 030 30',
    lines: ['Thank you for calling Coastal Homes.', 'Each owned home level adds one permanent garage slot. Your title and upgrades are saved to your citizen account.'],
    actionLabel: 'View properties', action: 'homes',
  },
  {
    id: 'mechanic', name: 'Cooperative Workshop', role: 'Performance upgrades', number: '+231 77 040 40',
    lines: ['Workshop speaking. We tune engines, brakes and all-weather tires through level three.', 'Park and exit before selecting or upgrading a vehicle. Active trips must be finished first.'],
    actionLabel: 'Open workshop', action: 'garage',
  },
]);

/** Local, scripted NPC telephone calls. No real-world telephony or voice service is implied. */
export class PhoneSystem {
  private active?: PhoneCallSnapshot;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly onChange: (call: PhoneCallSnapshot | null) => void) {}

  start(contactId: string) {
    const contact = PHONE_CONTACTS.find((entry) => entry.id === contactId);
    if (!contact) return;
    this.end();
    this.active = { contact, status: 'connecting', elapsedSeconds: 0, visibleLines: [] };
    this.emit();
    this.schedule(() => {
      if (!this.active || this.active.contact.id !== contactId) return;
      this.active.status = 'connected';
      this.active.visibleLines = [contact.lines[0]!];
      this.emit();
      for (let index = 1; index < contact.lines.length; index += 1) {
        this.schedule(() => {
          if (!this.active || this.active.contact.id !== contactId) return;
          this.active!.visibleLines = contact.lines.slice(0, index + 1);
          this.emit();
        }, index * 1600);
      }
    }, 750);
    this.schedule(() => {
      const interval = setInterval(() => {
        if (!this.active || this.active.status !== 'connected') return;
        this.active.elapsedSeconds += 1;
        this.emit();
      }, 1000);
      this.timers.add(interval);
    }, 750);
  }

  end() {
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers.clear();
    this.active = undefined;
    this.emit();
  }

  private schedule(work: () => void, delay: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      work();
    }, delay);
    this.timers.add(timer);
  }

  private emit() { this.onChange(this.active ? { ...this.active, visibleLines: [...this.active.visibleLines] } : null); }
}
