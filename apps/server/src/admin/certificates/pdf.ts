import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// Certificate PDFs (plan D25), generated on demand: nothing is stored.

export interface CertificatePdfInput {
  certId: string;
  type: "participation" | "winner" | "mentor";
  name: string;
  eventName: string;
  issuedAt: Date;
  rank?: number;
  teamName?: string;
  verifyUrl: string;
}

const TITLES = {
  participation: "Certificate of Participation",
  winner: "Certificate of Achievement",
  mentor: "Certificate of Appreciation",
} as const;

const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

function line(input: CertificatePdfInput): string {
  if (input.type === "winner") {
    return `for securing ${ordinal(input.rank ?? 1)} place${input.teamName ? ` with team ${input.teamName}` : ""} at`;
  }
  if (input.type === "mentor") return "for mentoring participants at";
  return "for participating in";
}

export async function certificatePdf(input: CertificatePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${TITLES[input.type]} – ${input.name}`);
  pdf.setAuthor("HACKOS");
  const page = pdf.addPage([842, 595]); // A4 landscape
  const { width, height } = page.getSize();
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.12, 0.14, 0.2);
  const accent = rgb(0.2, 0.33, 0.75);

  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: accent, borderWidth: 3 });
  page.drawRectangle({ x: 34, y: 34, width: width - 68, height: height - 68, borderColor: accent, borderWidth: 0.75 });

  const center = (text: string, y: number, size: number, font = sans, color = ink) => {
    // Standard fonts only cover Latin-1; drop anything else rather than fail.
    const safe = text.replace(/[^\x20-\xFF]/g, "");
    page.drawText(safe, { x: (width - font.widthOfTextAtSize(safe, size)) / 2, y, size, font, color });
  };

  center("HACKOS", height - 110, 16, sans, accent);
  center(TITLES[input.type], height - 170, 36, serif);
  center("This is to certify that", height - 230, 14);
  center(input.name, height - 285, 32, serif, accent);
  center(line(input), height - 330, 14);
  center(input.eventName, height - 365, 20, serif);
  center(`Issued ${input.issuedAt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`, height - 410, 12);

  page.drawText(`Certificate ID: ${input.certId}`, { x: 60, y: 60, size: 9, font: sans, color: ink });
  page.drawText(`Verify: ${input.verifyUrl}`, { x: 60, y: 46, size: 9, font: sans, color: accent });
  return pdf.save();
}
