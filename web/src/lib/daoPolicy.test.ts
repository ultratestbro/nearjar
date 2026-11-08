import { describe, expect, it } from "vitest";
import {
  addProposalArgs,
  approvalsFor,
  canSpendIntents,
  daoLabel,
  governance,
  isDaoId,
  memberCount,
  memberRoles,
  membership,
  parseDaoId,
  parsePolicy,
  soloText,
  spendShort,
  spendText,
  trezuTemplate,
  trezuUrl,
  type DaoPolicy,
} from "./daoPolicy";
import agentic from "./__fixtures__/policy-agentic.json";
import hotDao from "./__fixtures__/policy-hot-dao.json";
import shitzu from "./__fixtures__/policy-shitzu.json";
import templar from "./__fixtures__/policy-templar.json";
import wasmMusic from "./__fixtures__/policy-webassemblymusic-treasury.json";

// recorded get_policy answers, 2026-11-08
const policy = (raw: unknown): DaoPolicy => {
  const p = parsePolicy(raw);
  if (!p) throw new Error("fixture is not a policy");
  return p;
};
const SHITZU = policy(shitzu);
const TEMPLAR = policy(templar);
const AGENTIC = policy(agentic);
const HOT = policy(hotDao);
const WASM = policy(wasmMusic);
const HOT_MEMBER = "5c7c8b5a32c607e2139f6717c614652605ed2596a2d36fd5557c7634deb7c340";

const HALF = { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] };
/** A policy the way get_policy returns it; roles without their own rules use `defaultRule`. */
const raw = (roles: Record<string, unknown>[], defaultRule: unknown = HALF): DaoPolicy =>
  policy({ roles: roles.map((r) => ({ vote_policy: {}, ...r })), default_vote_policy: defaultRule });
const group = (name: string, members: string[], permissions: string[], vote_policy: Record<string, unknown> = {}) => ({
  name,
  kind: { Group: members },
  permissions,
  vote_policy,
});
const weight = (w: string, quorum = "0") => ({ weight_kind: "RoleWeight", quorum, threshold: w });

describe("parseDaoId", () => {
  it.each([
    ["shitzu", "shitzu.sputnik-dao.near"],
    ["  Shitzu.Sputnik-DAO.near ", "shitzu.sputnik-dao.near"],
    ["webassemblymusic-treasury.sputnik-dao.near", "webassemblymusic-treasury.sputnik-dao.near"],
    ["https://trezu.app/templar.sputnik-dao.near", "templar.sputnik-dao.near"],
    ["https://trezu.app/templar.sputnik-dao.near/dashboard?tab=assets", "templar.sputnik-dao.near"],
    ["trezu.app/agentic.sputnik-dao.near", "agentic.sputnik-dao.near"],
    ["https://www.trezu.app/hot-dao", "hot-dao.sputnik-dao.near"],
  ])("%s → %s", (input, want) => expect(parseDaoId(input)).toBe(want));

  it.each([
    "",
    "evil.near",
    "x.sputnik-dao.near.evil.near",
    "sputnik-dao.near",
    ".sputnik-dao.near",
    "a.b.sputnik-dao.near",
    "x.sputnik-dao.nearx",
    "xsputnik-dao.near",
    "-x.sputnik-dao.near",
    "x_.sputnik-dao.near",
    "x y.sputnik-dao.near",
    `${"a".repeat(48)}.sputnik-dao.near`, // 65 characters
    "https://trezu.app.evil.com/shitzu.sputnik-dao.near",
    "https://evil.com/trezu.app/shitzu.sputnik-dao.near",
    "https://trezu.app/x.sputnik-dao.near.evil.near",
    "https://trezu.app/%E0%A4%A",
  ])("refuses %j", (input) => expect(parseDaoId(input)).toBeNull());

  it("refuses non-strings", () => {
    expect(parseDaoId(undefined)).toBeNull();
    expect(parseDaoId(null)).toBeNull();
    expect(parseDaoId({ dao: "shitzu" })).toBeNull();
  });
});

describe("isDaoId (signed ids: exact, no case folding)", () => {
  it("accepts the canonical form only", () => {
    expect(isDaoId("shitzu.sputnik-dao.near")).toBe(true);
    expect(isDaoId(`${"a".repeat(47)}.sputnik-dao.near`)).toBe(true); // 64 characters
    expect(isDaoId("Shitzu.sputnik-dao.near")).toBe(false);
    expect(isDaoId("shitzu")).toBe(false);
    expect(isDaoId(" shitzu.sputnik-dao.near")).toBe(false);
    expect(isDaoId("sputnik-dao.near")).toBe(false);
    expect(isDaoId("a.b.sputnik-dao.near")).toBe(false);
    expect(isDaoId(42)).toBe(false);
    expect(isDaoId(null)).toBe(false);
  });

  it("names and links", () => {
    expect(daoLabel("shitzu.sputnik-dao.near")).toBe("shitzu");
    expect(trezuUrl("shitzu.sputnik-dao.near")).toBe("https://trezu.app/shitzu.sputnik-dao.near");
  });
});

describe("parsePolicy", () => {
  it("refuses what isn't a Sputnik policy", () => {
    expect(parsePolicy(null)).toBeNull();
    expect(parsePolicy({})).toBeNull();
    expect(parsePolicy({ roles: "x" })).toBeNull();
    expect(parsePolicy({ roles: [{ name: "r", kind: "Everyone" }] })).toBeNull();
    expect(parsePolicy({ roles: [{ name: "r", kind: "Everyone", permissions: [1] }] })).toBeNull();
  });
});

describe("membership", () => {
  it("shitzu: a council member is in, an outsider isn't (Everyone grants transfer:AddProposal)", () => {
    expect(memberRoles(SHITZU, "sealteam666.near")).toEqual(["council"]);
    expect(membership(SHITZU, "random-outsider.near")).toBe(false);
    expect(memberCount(SHITZU)).toBe(9);
  });

  it("webassemblymusic: a member of all three Trezu roles", () => {
    expect(memberRoles(WASM, "petersalomonsen.near")).toEqual(["Create Requests", "Manage Members", "Vote"]);
    expect(memberCount(WASM)).toBe(2);
  });

  it("hot-dao: implicit accounts", () => {
    expect(memberRoles(HOT, HOT_MEMBER)).toEqual(["council"]);
    expect(membership(HOT, "near")).toBe(false);
  });

  it("templar and agentic", () => {
    expect(membership(TEMPLAR, "corpogoose.near")).toBe(true);
    expect(memberRoles(AGENTIC, "multiagentic.near")).toEqual(["Requestor", "Admin", "Approver"]);
    expect(memberCount(AGENTIC)).toBe(1);
  });

  it("token-weighted and empty-permission roles don't make a member", () => {
    const p = raw([
      { name: "token", kind: { Member: "1" }, permissions: ["*:*"] },
      group("empty", ["a.near"], []),
      { name: "all", kind: "Everyone", permissions: ["*:*"] },
    ]);
    expect(membership(p, "a.near")).toBe(false);
    expect(membership(p, "b.near")).toBe(false);
    expect(memberCount(p)).toBe(0);
  });
});

describe("canSpendIntents", () => {
  it("every recorded DAO lets its members spend", () => {
    expect(canSpendIntents(SHITZU, "sealteam666.near")).toBe(true); // call:AddProposal + call:VoteApprove
    expect(canSpendIntents(TEMPLAR, "rf1111.near")).toBe(true); // Create Requests files, Vote approves
    expect(canSpendIntents(AGENTIC, "multiagentic.near")).toBe(true); // Requestor files, Approver approves
    expect(canSpendIntents(HOT, HOT_MEMBER)).toBe(true); // *:*
    expect(canSpendIntents(WASM, "psalomo.near")).toBe(true); // *:VoteApprove
  });

  it("outsiders can't, even where Everyone may file requests", () => {
    expect(canSpendIntents(SHITZU, "random-outsider.near")).toBe(false);
    expect(canSpendIntents(HOT, "near")).toBe(false);
  });

  it("a member who can only file transfers can't", () => {
    const p = raw([group("council", ["a.near"], ["transfer:AddProposal", "*:VoteApprove"])]);
    expect(membership(p, "a.near")).toBe(true);
    expect(canSpendIntents(p, "a.near")).toBe(false);
  });

  it("nobody able to approve a call proposal means no", () => {
    const p = raw([
      group("proposers", ["a.near"], ["call:AddProposal", "transfer:VoteApprove"]),
      // the only approver role has nobody in it
      group("approvers", [], ["call:VoteApprove"]),
    ]);
    expect(canSpendIntents(p, "a.near")).toBe(false);
  });

  it("Everyone approving doesn't count: Sputnik skips that role when it counts votes", () => {
    const p = raw([
      group("proposers", ["a.near"], ["call:AddProposal"]),
      { name: "all", kind: "Everyone", permissions: ["call:VoteApprove", "*:*"] },
    ]);
    expect(canSpendIntents(p, "a.near")).toBe(false);
    expect(approvalsFor(p, "call").best).toBeNull();
  });

  it("a quorum the role can't reach means no", () => {
    const p = raw([group("council", ["a.near", "b.near"], ["call:*"], { call: weight("1", "3") })]);
    expect(canSpendIntents(p, "a.near")).toBe(false);
  });

  it("token-weighted approvals aren't counted", () => {
    const tokenRule = { weight_kind: "TokenWeight", quorum: "0", threshold: [1, 2] };
    const p = raw([group("proposers", ["a.near"], ["call:AddProposal"]), { name: "holders", kind: { Member: "1" }, permissions: ["call:VoteApprove"] }]);
    expect(canSpendIntents(p, "a.near")).toBe(false);
    const q = raw([group("council", ["a.near", "b.near"], ["call:*"], { call: tokenRule })]);
    expect(canSpendIntents(q, "a.near")).toBe(false);
    expect(approvalsFor(q, "call")).toEqual({ best: null, unknown: true });
  });

  it("wildcards count on either side", () => {
    const p = (perms: string[]) => raw([group("r", ["a.near"], perms)]);
    expect(canSpendIntents(p(["call:*"]), "a.near")).toBe(true);
    expect(canSpendIntents(p(["*:AddProposal", "*:VoteApprove"]), "a.near")).toBe(true);
    expect(canSpendIntents(p(["*:AddProposal", "transfer:VoteApprove"]), "a.near")).toBe(false);
    expect(canSpendIntents(p(["call:VoteApprove"]), "a.near")).toBe(false);
  });
});

describe("governance: who can move a DAO treasury", () => {
  it("the recorded DAOs, as Sputnik's proposal_status counts votes", () => {
    // shitzu: 9 council members, call threshold Weight 3
    expect(governance(SHITZU)).toEqual({ members: 9, spend: { role: "council", approvals: 3, of: 9 }, solo: null });
    // hot-dao: 4 council, Ratio 60/100 → 4 * 60 / 100 + 1 = 3
    expect(governance(HOT)).toEqual({ members: 4, spend: { role: "council", approvals: 3, of: 4 }, solo: null });
    // templar: the Vote role approves with Weight 2 of 4; Manage Members needs 2 for policy changes
    expect(governance(TEMPLAR)).toEqual({ members: 4, spend: { role: "Vote", approvals: 2, of: 4 }, solo: null });
    // agentic: one account holds every role, threshold 1
    expect(governance(AGENTIC)).toEqual({ members: 1, spend: { role: "Approver", approvals: 1, of: 1 }, solo: "spend" });
    // webassemblymusic: either of the 2 Vote members approves alone
    expect(governance(WASM)).toEqual({ members: 2, spend: { role: "Vote", approvals: 1, of: 2 }, solo: "spend" });
  });

  it("texts for the jar page", () => {
    expect(spendText(governance(SHITZU))).toBe("Spending needs 3 of the 9 members of “council”");
    expect(spendText(governance(AGENTIC))).toBe("Spending needs the one member of “Approver”");
    expect(soloText(governance(SHITZU))).toBeNull();
    expect(soloText(governance(WASM))).toBe("One member can approve spending alone");
    expect(spendShort(governance(SHITZU))).toBe("Spending: 3 of 9 approvals");
    expect(spendShort(governance(AGENTIC))).toBe("Spending: 1 approval");
    expect(spendShort(governance(WASM))).toBe("Spending: 1 of 2 approvals");
  });

  it("one member who can rewrite the policy alone counts as acting alone", () => {
    const p = raw([
      group("council", ["a.near", "b.near", "c.near"], ["call:*"], { call: weight("2") }),
      group("admins", ["a.near"], ["policy:*"], { policy: weight("1") }),
    ]);
    expect(governance(p)).toMatchObject({ spend: { approvals: 2, of: 3 }, solo: "rules" });
    expect(soloText(governance(p))).toBe("One member can change its rules alone");
  });

  it("a member can add a sock puppet alone: also acting alone", () => {
    const p = raw([group("council", ["a.near", "b.near"], ["call:*", "add_member_to_role:*"], { call: weight("2"), add_member_to_role: weight("1") })]);
    expect(governance(p).solo).toBe("rules");
  });

  it("ratio thresholds follow WeightOrRatio::to_weight, capped at the role size", () => {
    const of = (n: number, threshold: unknown) =>
      approvalsFor(raw([group("c", Array.from({ length: n }, (_, i) => `m${i}.near`), ["call:*"], { call: { weight_kind: "RoleWeight", quorum: "0", threshold } })]), "call").best?.approvals;
    expect(of(1, [1, 2])).toBe(1);
    expect(of(2, [1, 2])).toBe(2);
    expect(of(3, [1, 2])).toBe(2);
    expect(of(9, [2, 5])).toBe(4);
    expect(of(3, "10")).toBe(3); // a weight above the size is capped
    expect(of(3, "0")).toBe(1); // somebody still has to vote
  });

  it("the default vote policy applies to kinds a role has no rule for", () => {
    const p = raw([group("council", ["a.near", "b.near", "c.near", "d.near"], ["*:*"])], weight("1"));
    expect(governance(p)).toMatchObject({ spend: { approvals: 1, of: 4 }, solo: "spend" });
  });

  it("an unreadable vote rule is unknown, never a pass", () => {
    const p = raw([group("council", ["a.near", "b.near"], ["call:*"], { call: { weight_kind: "RoleWeight", quorum: "x", threshold: "2" } })]);
    expect(approvalsFor(p, "call")).toEqual({ best: null, unknown: true });
    expect(governance(p).solo).toBe("unsized");
  });
});

describe("the DAO's calls", () => {
  it("a Trezu request template for endorse_jar: strings for the ids, deposit 0, 30 Tgas", () => {
    const t = JSON.parse(trezuTemplate("nearjar.near", "endorse_jar", "5", "2"));
    expect(t).toMatchObject({
      version: 1,
      id: "nearjar-endorse",
      binding: { receiver_id: "nearjar.near", method_name: "endorse_jar", deposit: "0", gas: "30000000000000" },
      args: { jar_id: "{{jar_id}}", revision: "{{revision}}" },
    });
    expect(t.fields).toEqual([
      expect.objectContaining({ name: "jar_id", type: "uint", default: "5" }),
      expect.objectContaining({ name: "revision", type: "uint", default: "2" }),
    ]);
    const close = JSON.parse(trezuTemplate("nearjar.near", "dao_close_jar", "5", "2"));
    expect(close.args).toEqual({ jar_id: "{{jar_id}}" });
    expect(close.binding.method_name).toBe("dao_close_jar");
  });

  it("near-cli add_proposal args carry the call base64-encoded, as Sputnik's FunctionCall takes it", () => {
    const p = JSON.parse(addProposalArgs("nearjar.near", "endorse_jar", '{"jar_id":"5","revision":"2"}', "Endorse"));
    const call = p.proposal.kind.FunctionCall;
    expect(call.receiver_id).toBe("nearjar.near");
    expect(call.actions).toHaveLength(1);
    expect(call.actions[0]).toMatchObject({ method_name: "endorse_jar", deposit: "0", gas: "30000000000000" });
    expect(JSON.parse(atob(call.actions[0].args))).toEqual({ jar_id: "5", revision: "2" });
  });
});
