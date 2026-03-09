import { connectDatabase } from "../core/database.js";
import { syncModels } from "../database/associations.js";
import { Modality } from "../database/models/Modality.js";
import { Season } from "../database/models/Season.js";

async function seed() {
    await connectDatabase();
    await syncModels();

    const [x4, x4Created] = await Modality.findOrCreate({
        where: { name: "x4" },
        defaults: {
            name: "x4",
            displayName: "X4",
            playersPerTeam: 12,
            isActive: true,
        },
    });

    const [x5, x5Created] = await Modality.findOrCreate({
        where: { name: "x5" },
        defaults: {
            name: "x5",
            displayName: "X5",
            playersPerTeam: 15,
            isActive: true,
        },
    });

    console.log(`${x4Created ? "✅ Creada" : "⏭️  Ya existía"} — Modalidad X4 (id: ${x4.id})`);
    console.log(`${x5Created ? "✅ Creada" : "⏭️  Ya existía"} — Modalidad X5 (id: ${x5.id})`);

    const [s1x4, s1x4Created] = await Season.findOrCreate({
        where: { name: "Temporada 1", modalityId: x4.id },
        defaults: {
            name: "Temporada 1",
            modalityId: x4.id,
            isActive: true,
            startedAt: new Date(),
        },
    });

    const [s1x5, s1x5Created] = await Season.findOrCreate({
        where: { name: "Temporada 1", modalityId: x5.id },
        defaults: {
            name: "Temporada 1",
            modalityId: x5.id,
            isActive: true,
            startedAt: new Date(),
        },
    });

    console.log(`${s1x4Created ? "✅ Creada" : "⏭️  Ya existía"} — Temporada 1 X4 (id: ${s1x4.id})`);
    console.log(`${s1x5Created ? "✅ Creada" : "⏭️  Ya existía"} — Temporada 1 X5 (id: ${s1x5.id})`);

    console.log("\n🎉 Seed completado.");
    process.exit(0);
}

seed().catch((err) => {
    console.error("❌ Error en seed:", err);
    process.exit(1);
});