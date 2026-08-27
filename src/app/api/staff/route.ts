import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";
import { z } from "zod";

export async function GET() {
  try {
    await requireRole("ADMIN");
    const staff = await db.staffRecord.findMany({
      orderBy: { createdAt: "desc" },
    });
    return ok(staff);
  } catch (e) {
    return handleApiError(e);
  }
}

const createSchema = z.object({
  name: z.string().min(2),
  designation: z.string(),
  department: z.string().optional(),
  salary: z.number().default(0),
  contactNumber: z.string().optional(),
  joiningDate: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    await requireRole("ADMIN");
    const body = await req.json();
    const data = createSchema.parse(body);
    const staff = await db.staffRecord.create({
      data: {
        ...data,
        joiningDate: data.joiningDate ? new Date(data.joiningDate) : new Date(),
        status: "ACTIVE",
      },
    });
    return ok(staff, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
