import { AutocompleteInteraction } from "discord.js";
import { Modality } from "../database/models/Modality.js";

export async function autocompleteModality(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();

  const modalities = await Modality.findAll({ where: { isActive: true } });

  const filtered = modalities
    .filter(
      (m) =>
        m.name.toLowerCase().includes(focused) ||
        m.displayName.toLowerCase().includes(focused),
    )
    .slice(0, 25);

  await interaction.respond(
    filtered.map((m) => ({ name: m.displayName, value: m.name })),
  );
}
