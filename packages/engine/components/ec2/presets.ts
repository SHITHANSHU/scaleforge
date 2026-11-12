import type { Preset } from "../../core/types";

const source = { title: "AWS EC2 instance types & on-demand pricing (us-east-1) — verify before relying on it", url: "https://aws.amazon.com/ec2/instance-types/" };
const p = (id: string, label: string, v: Record<string, number | boolean>): Preset => ({
  id, label, version: 1, approximate: true, source, builtin: true, values: v,
});

// creditsPerHour/launchCredits follow AWS's published T2 credit model; network & prices are approximate.
export const ec2Presets: Preset[] = [
  p("t2.nano", "t2.nano", { vcpu: 1, memoryGiB: 0.5, burstable: true, creditsPerHour: 3, initialCredits: 30, networkMbps: 30, costPerHourEach: 0.0058 }),
  p("t2.micro", "t2.micro", { vcpu: 1, memoryGiB: 1, burstable: true, creditsPerHour: 6, initialCredits: 30, networkMbps: 60, costPerHourEach: 0.0116 }),
  p("t2.small", "t2.small", { vcpu: 1, memoryGiB: 2, burstable: true, creditsPerHour: 12, initialCredits: 30, networkMbps: 125, costPerHourEach: 0.023 }),
  p("t2.medium", "t2.medium", { vcpu: 2, memoryGiB: 4, burstable: true, creditsPerHour: 24, initialCredits: 60, networkMbps: 250, costPerHourEach: 0.0464 }),
  p("m5.large", "m5.large", { vcpu: 2, memoryGiB: 8, burstable: false, creditsPerHour: 0, initialCredits: 0, networkMbps: 750, costPerHourEach: 0.096 }),
  p("c5.large", "c5.large", { vcpu: 2, memoryGiB: 4, burstable: false, creditsPerHour: 0, initialCredits: 0, networkMbps: 750, costPerHourEach: 0.085 }),
];
