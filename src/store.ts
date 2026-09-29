import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type CaseRecord = {
  id: number;
  guildId: string;
  moderatorId: string;
  userId: string;
  action: string;
  reason: string;
  createdAt: string;
};

export type TicketRecord = {
  channelId: string;
  guildId: string;
  openerId: string;
  claimedBy: string | null;
  status: "open" | "closed";
  createdAt: string;
};

export type ApplicationRecord = {
  id: string;
  guildId: string;
  userId: string;
  kind: "staff" | "community";
  answers: string[];
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

type State = {
  cases: CaseRecord[];
  tickets: TicketRecord[];
  applications: ApplicationRecord[];
};

const path = resolve("data", "kynox-data.json");
const emptyState = (): State => ({ cases: [], tickets: [], applications: [] });

function load(): State {
  if (!existsSync(path)) return emptyState();
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<State>;
  return {
    cases: parsed.cases ?? [],
    tickets: parsed.tickets ?? [],
    applications: parsed.applications ?? [],
  };
}

let state = load();

function save(): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

export const store = {
  addCase(record: Omit<CaseRecord, "id" | "createdAt">): CaseRecord {
    const entry: CaseRecord = {
      ...record,
      id: state.cases.reduce((max, item) => Math.max(max, item.id), 0) + 1,
      createdAt: new Date().toISOString(),
    };
    state.cases.push(entry);
    save();
    return entry;
  },
  getCase(guildId: string, id: number): CaseRecord | undefined {
    return state.cases.find((record) => record.guildId === guildId && record.id === id);
  },
  getCasesForUser(guildId: string, userId: string): CaseRecord[] {
    return state.cases
      .filter((record) => record.guildId === guildId && record.userId === userId)
      .sort((left, right) => right.id - left.id);
  },
  addTicket(record: TicketRecord): void {
    state.tickets.push(record);
    save();
  },
  getOpenTicket(guildId: string, openerId: string): TicketRecord | undefined {
    return state.tickets.find(
      (ticket) => ticket.guildId === guildId && ticket.openerId === openerId && ticket.status === "open",
    );
  },
  getTicket(channelId: string): TicketRecord | undefined {
    return state.tickets.find((ticket) => ticket.channelId === channelId);
  },
  updateTicket(channelId: string, update: Partial<TicketRecord>): void {
    const ticket = this.getTicket(channelId);
    if (!ticket) return;
    Object.assign(ticket, update);
    save();
  },
  addApplication(record: ApplicationRecord): void {
    state.applications.push(record);
    save();
  },
  getApplication(id: string): ApplicationRecord | undefined {
    return state.applications.find((application) => application.id === id);
  },
  updateApplication(id: string, status: "approved" | "rejected"): void {
    const application = this.getApplication(id);
    if (!application) return;
    application.status = status;
    save();
  },
};