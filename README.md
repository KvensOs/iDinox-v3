<div align="center">

#  iDinox v3

### Bot de gestión de ligas para HaxBall
Todo desde Discord. Sin gestores externos. Sin trabajo manual cada temporada.

<br/>

![Node](https://img.shields.io/badge/Node.js_≥18-339933?style=for-the-badge&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript_5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Discord.js](https://img.shields.io/badge/Discord.js_v14-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite_+_Sequelize-003B57?style=for-the-badge&logo=sqlite&logoColor=white)

![License](https://img.shields.io/badge/Licencia-MIT-22c55e?style=for-the-badge)
![Status](https://img.shields.io/badge/Estado-Fase_5_%F0%9F%94%A8-f59e0b?style=for-the-badge)
![HaxBall](https://img.shields.io/badge/Hecho_para-HaxBall-e85d3f?style=for-the-badge)

</div>

---

## El problema

La mayoría de ligas de HaxBall se organizan con gestores como **Challenge Place** o **Arena17**. Funcionan bien para la tabla y los resultados, pero no van más allá. No hay estadísticas separadas por temporada, no hay historial de títulos, no hay perfil de jugador con su recorrido completo.

Lo que queda fuera del gestor — fichajes, altas, bajas, nicknames, premios — termina en manos del admin, que lo gestiona a mano temporada tras temporada.

iDinox cubre esa parte. Mercado de fichajes, estadísticas por competencia y temporada, perfiles históricos, premios y ciclo de temporadas completo, todo desde Discord.

> La tabla de posiciones, resultados y gestión de fechas están planificados para la **v4**. Por ahora sigues usando tu gestor para eso.

---

## Qué hace

- 🏟️ Gestiona **equipos** completos: logo, uniformes, DT, abreviación y rol de Discord vinculado
- 🔄 Controla el **mercado de fichajes** con flujo de confirmación y notificaciones automáticas
- 📊 Registra **estadísticas** por jugador, competencia y temporada — separadas, sin mezclarlas nunca
- 👤 **Perfiles históricos** de jugadores: stats acumuladas, temporadas jugadas, premios ganados
- 🏆 Sistema de **premios y títulos** por temporada, individuales y de equipo
- 📁 **Historial permanente** aunque equipos o competencias se eliminen
- ♻️ **Roster carry automático** al arrancar una temporada nueva
- 🎮 Soporte para **múltiples modalidades** (X4, X5…) completamente independientes en el mismo servidor
- ⚡ Todo con **slash commands** y autocomplete dinámico desde la base de datos

---

## Instalación

```bash
git clone https://github.com/KvensOs/iDinox-v3.git
cd iDinox-v3

npm install

cp .env.example .env
# editar .env con tu token y client ID

# seed inicial — crea las modalidades base y la primera temporada
npx tsx src/scripts/seed.ts

npx tsx src/index.ts
```

Una vez arriba, lo primero es configurar cada modalidad desde Discord con `/setup`.

---

## Variables de entorno

El archivo `.env` necesita estas variables:

| Variable            | Descripción                                                                          |
| ------------------- | ------------------------------------------------------------------------------------ |
| `DISCORD_TOKEN`     | Token del bot.                                                                       |
| `CLIENT_ID`         | ID de la aplicación en Discord.                                                      |
| `GUILD_ID`          | ID del servidor donde corre el bot.                                                  |
| `ERROR_WEBHOOK_URL` | Webhook para notificar errores críticos. Opcional pero recomendado.                  |
| `NODE_ENV`          | `development` o `production`.                                                        |
| `DB_SYNC`           | `true` para sincronizar modelos al iniciar.                                          |
| `DB_SYNC_ALTER`     | `true` para alterar tablas existentes sin destruir datos.                            |
| `DB_SYNC_FORCE`     | `true` para recrear todas las tablas desde cero. **Destructivo.**                    |
| `SEASON_SECRET`     | Clave requerida para `/season new` y `/season end`. Solo letras, números y guiones.  |

> **Importante con `SEASON_SECRET`:** no uses `#`, `$`, `@` ni otros caracteres especiales. Discord puede escaparlos al copiar el valor en un slash command y la clave no va a coincidir.

---

## Configuración inicial

Antes de hacer cualquier cosa con el bot hay que decirle qué roles y canales usar en cada modalidad. Esto se hace con `/setup` desde Discord:

```
/setup modalidad:X4 campo:rol_admin              valor:@Admin X4
/setup modalidad:X4 campo:rol_dt                 valor:@Director Técnico
/setup modalidad:X4 campo:rol_sub_dt             valor:@Sub-DT
/setup modalidad:X4 campo:rol_estadistiquero     valor:@Estadistiquero
/setup modalidad:X4 campo:canal_logs             valor:#logs-x4
/setup modalidad:X4 campo:canal_mercado_fichajes valor:#fichajes-x4
/setup modalidad:X4 campo:canal_mercado_bajas    valor:#bajas-x4
/setup modalidad:X4 campo:canal_resultados       valor:#resultados-x4
```

Sin esto los permisos y el mercado no van a funcionar. Usar `/setup` sin argumentos muestra la configuración actual de la modalidad.

Si tienes X4 y X5, repite el proceso para cada una — son universos completamente separados.

---

## Comandos

### Configuración y equipos

| Comando | Qué hace |
| --- | --- |
| `/setup` | Configura roles y canales de una modalidad. Sin argumentos muestra la configuración actual. |
| `/start` | Te registra como jugador en la temporada activa de una modalidad. Si ya tienes ficha, actualiza tu posición. |
| `/league-team add` | Crea un equipo, descarga el logo al servidor, crea el Participant del DT y le asigna el nickname `[ABREV] DT Nombre`. |
| `/league-team edit` | Edita nombre, abreviación, rol, logo o uniformes. Si cambia la abreviación, renombra el archivo de logo y actualiza los nicknames de toda la plantilla. |
| `/league-team delete` | Soft delete: desactiva el equipo, libera el rol y desvincula a los jugadores. Preserva todo el historial. |
| `/league-competition new` | Crea una competencia en la temporada activa. Puedes asignar un canal de stats existente o usar `crear_canal:True` para que el bot lo cree con los permisos configurados. |
| `/league-competition edit` | Edita nombre, tipo o canal de estadísticas. |
| `/league-competition close` | Cierra la competencia sin borrar nada. Las stats quedan intactas. |
| `/league-competition delete` | Elimina permanentemente junto con todas sus stats y awards. |
| `/club-unis` | El DT o sub-DT edita los uniformes de su propio equipo. Requiere formato `/colors`. |

### Mercado de fichajes

El mercado tiene que estar abierto para que los DTs puedan fichar o dar de baja jugadores. Los admins de modalidad controlan cuándo abre y cierra.

| Comando | Qué hace |
| --- | --- |
| `/market open` | Abre el mercado. Notifica en los canales de fichajes y bajas configurados. |
| `/market close` | Cierra el mercado. |
| `/market estado` | Muestra si el mercado está abierto o cerrado. Público. |
| `/market agents` | Lista los jugadores sin equipo (agentes libres) en la temporada activa. Solo admins. |
| `/market sign` | Envía oferta de fichaje al jugador con botones Aceptar / Rechazar / Retirar. Al aceptar: asigna equipo, actualiza nickname y notifica en el canal de fichajes. |
| `/market release` | Da de baja al jugador: lo desvincula del equipo, limpia su nickname y notifica en el canal de bajas. |
| `/player-check` | Muestra el estado de un jugador en todas las modalidades activas: equipo, posición, temporada. Sin restricción de permisos. |

> Una oferta pendiente bloquea nuevas ofertas al mismo jugador en la misma modalidad mientras esté activa. Cada equipo tiene hasta 2 fichajes de emergencia por temporada para situaciones de baja urgente.

### Estadísticas y perfiles

| Comando | Qué hace |
| --- | --- |
| `/league-stats add` | Registra o corrige estadísticas manualmente. Tiene autocomplete de jugador y competencia. Mismos permisos que el canal dedicado. |
| `/perfil` | Perfil completo del jugador con navegación interactiva por menús: vista global, por modalidad, por temporada y por competencia. |
| `/club` | Ficha del equipo con plantilla completa, posiciones, stats de la temporada y campeonatos históricos. |
| `/league-tops` | Rankings por goles, asistencias, vallas y autogoles. Filtrable por competencia y temporada. |
| `/league-compare` | Comparativa directa entre dos jugadores en una misma competencia o temporada. |
| `/league-history` | Palmarés completo de una temporada: títulos de equipo e individuales. Público. |
| `/league-trophy add` | Registra un premio en la temporada activa. Tipo `team` o `individual`. Los de equipo crean automáticamente un registro por cada jugador activo del equipo. |
| `/league-trophy edit` | Edita nombre, notas y competencia asociada al premio. |
| `/league-trophy delete` | Elimina el premio y todos sus ganadores en cascade. |

### Temporadas

Las operaciones de temporada tienen seguridad extra: requieren `SEASON_SECRET` y el nombre exacto de la temporada a cerrar como confirmación. Antes de cualquier escritura se crea un backup automático del `.sqlite` en `backups/`.

| Comando | Qué hace |
| --- | --- |
| `/season new` | Crea una nueva temporada. Cierra la anterior, cierra sus competencias en cascade y hace roster carry automático de todos los jugadores con equipo. |
| `/season end` | Cierra la temporada activa sin crear una nueva. |
| `/season edit` | Renombra una temporada (activa o cerrada). Sin clave — no es destructivo. |
| `/season info` | Info de la temporada: fechas, participantes, equipos activos y competencias. Público. |

### Utilidades

| Comando | Qué hace |
| --- | --- |
| `/broadcast` | DM masivo a miembros de hasta 3 roles del servidor. Solo admins globales. |
| `/hora` | Hora actual en Venezuela (UTC-4) vs otras zonas de América. Sin permisos. |
| `/timestamp` | Generador de timestamps en todos los formatos de Discord (`<t:UNIX:F>`, `<t:UNIX:R>`, etc.). |
| `/ticket setup` | Configura un sistema de tickets: panel con botón, canal destino y rol de soporte. |
| `/upload` | Sube grabaciones de partidos a un canal configurado. |

---

## Sistema de estadísticas

Las stats se pueden cargar de dos formas. Ambas requieren `rol_estadistiquero` o `rol_admin` de la modalidad.

### Canal por competencia

La forma rápida. Cada competencia puede tener un canal de Discord dedicado. El bot escucha los mensajes en ese canal y procesa todo automáticamente.

Al crear o editar una competencia puedes asignar un canal existente o usar `crear_canal:True` para que el bot cree uno con nombre `stats-[competencia]-[modalidad]` y permisos configurados automáticamente.

Sintaxis:

```
@Jugador g2 a1
@Jugador cs1
@Jugador g-1 a1
@Jugador1 g1 @Jugador2 g2 a1
```

| Código | Stat |
| --- | --- |
| `g` | Goles |
| `a` | Asistencias |
| `cs` | Valla invicta |
| `ag` | Autogol |

Los valores negativos restan. Nunca pueden quedar en negativo — si el resultado sería menor a 0 se limita a 0 y el bot lo avisa. El bot responde con ✅ si todo fue bien o ❌ con descripción del error. Cada carga genera un log en `canal_logs` con el detalle de los cambios y quién los hizo.

### Comando `/league-stats add`

La alternativa formal. Útil para correcciones puntuales o cuando no tienes acceso al canal. Tiene autocomplete de jugador y competencia.

```
/league-stats add modalidad:X4 competicion:Liga Apertura jugador:@Jugador stats:g2 a1
```

---

## Perfiles

El `/perfil` es la vista central de un jugador. Funciona con menús desplegables y botón de volver, y el punto de entrada cambia según el historial del jugador:

- **1 modalidad, 1 temporada** → abre directo en esa temporada
- **1 modalidad, varias temporadas** → abre en el acumulado de la modalidad
- **Varias modalidades** → abre en la vista global

Las vistas disponibles son:

- **Global** — suma de todas las modalidades y temporadas, todos los premios
- **Modalidad** — acumulado de todas las temporadas en esa modalidad, equipo actual, stats totales
- **Temporada** — stats de esa temporada específica, equipo, posición y premios
- **Competencia** — stats desglosadas por competencia con G+A combinados

El jugador puede cambiar su posición desde su propio perfil en la vista de modalidad o temporada activa.

Los premios se muestran así:
- `🎖️ Máximo Goleador · [Liga D1] · Temporada 2` — competencia entre corchetes si es distinto al nombre del premio
- `🏆 Copa del Rey · con FC Barcelona · Temporada 2` — con el nombre del equipo ganador

---

## Temporadas y roster carry

Al crear una nueva temporada con `/season new`:

1. Se hace backup automático del `.sqlite`
2. Se cierran todas las competencias activas de la temporada anterior
3. Se cierra la temporada anterior
4. Se crea la nueva temporada
5. Todos los `Participant` con equipo asignado se copian a la nueva temporada automáticamente

Los agentes libres no se arrastran — tienen que usar `/start` para unirse. Los jugadores nuevos también.

El historial de stats, premios y participaciones de temporadas anteriores queda intacto para siempre.

---

## Permisos

Todos los permisos se verifican en tiempo real contra los roles de Discord del miembro. Nada se guarda en la base de datos.

| Nivel | Quién | Qué puede hacer |
| --- | --- | --- |
| **Admin global** | Dueño del servidor o portador del rol admin global | Todo, incluyendo cambiar `rol_admin` y gestionar temporadas |
| **Admin de modalidad** | Tiene `rol_admin` de la modalidad | Equipos, mercado, competencias, stats y premios |
| **DT / Sub-DT** | Tiene `rol_dt` o `rol_sub_dt` | Fichajes y bajas de su propio equipo, uniformes |
| **Estadistiquero** | Tiene `rol_estadistiquero` | Cargar y corregir stats por canal o comando |
| **Público** | Cualquiera | `/perfil`, `/club`, `/league-history`, `/season info`, `/market estado`, `/player-check` |

> El DT no se almacena en la base de datos. Se detecta dinámicamente: quien tiene `rol_dt` y tiene Participant activo en ese equipo durante esa temporada es el DT. Para cambiar de DT basta con reasignar el rol en Discord.

---

## Base de datos

8 modelos relacionales en SQLite con Sequelize. Toda operación destructiva corre dentro de una transacción Sequelize — si algo falla hay rollback completo sin tocar la DB.

```
Modality → Season → Competition
         → Team

Season   → Participant ← Player
Team     → Participant

Participant → Stat ← Competition

Season   → Award → AwardWinner
Modality → Award
```

| Modelo | Qué representa |
| --- | --- |
| `Modality` | Modalidad de juego (X4, X5…). Guarda toda la configuración de Discord en un campo JSON. |
| `Season` | Temporada de una modalidad. Solo puede haber una activa por modalidad. |
| `Team` | Equipo con logo, uniformes y rol de Discord. Soft delete para preservar historial. |
| `Player` | Registro global del usuario de Discord. Un Discord ID, un perfil, independiente de temporada o modalidad. |
| `Participant` | Nodo central. Une `Player` + `Team` + `Season`. `teamId = null` significa agente libre. Índice único sobre `(playerId, seasonId, modalityId)`. |
| `Competition` | Liga, copa, amistoso u otro. Hereda la modalidad de su Season. Puede tener canal de stats asignado. |
| `Stat` | Stats de un Participant en una Competition específica. Nunca se mezclan entre temporadas ni competencias. |
| `Award` / `AwardWinner` | Premio o título, individual o de equipo. Los de equipo generan una fila por cada Participant activo. Sobreviven aunque la competencia o el equipo se eliminen. |

Los delete en cascade están configurados así:
- `Season` eliminada → borra sus `Award` y `Participant`
- `Competition` eliminada → borra sus `Stat`, pone `NULL` en `Award.competitionId`
- `Award` eliminado → borra sus `AwardWinner`
- `Participant` eliminado → borra sus `Stat`
- `Team` eliminado (soft) → pone `NULL` en `Participant.teamId`

---

## Estructura del proyecto

```
iDinox-v3/
├── src/
│   ├── commands/          # Slash commands organizados por módulo
│   ├── core/              # Conexión a DB y cliente Discord
│   ├── database/
│   │   └── models/        # Modelos Sequelize
│   ├── events/            # messageCreate, interactionCreate, ready...
│   ├── utils/             # Logger, permisos, autocomplete, statsHelper
│   └── scripts/           # Seed y utilidades de mantenimiento
├── logos/                 # Logos de equipos (generado automáticamente)
├── backups/               # Backups automáticos del .sqlite
└── .env
```

---

## Hoja de ruta

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1 — Configuración y equipos | `/setup`, `/league-team`, `/league-competition`, `/start`, `/club-unis` | ✅ Completado |
| 2 — Mercado de fichajes | `/market`, `/player-check` | ✅ Completado |
| 3 — Estadísticas y perfiles | `/league-stats`, `/perfil`, `/club`, `/league-tops`, `/league-compare`, `/league-history`, `/league-trophy`, canal de stats | ✅ Completado |
| 4 — Gestión de temporadas | `/season new/end/edit/info` | ✅ Completado |
| 5 — Utilidades | `/broadcast`, `/hora`, `/timestamp`, `/ticket setup`, `/upload` | 🔄 En desarrollo |

---

## Stack

| Tecnología | Versión | Uso |
| --- | --- | --- |
| Node.js | ≥ 18 | Runtime |
| TypeScript | 5.x (ESM) | Lenguaje principal |
| Discord.js | v14 | Integración con Discord |
| Sequelize | 6.x | ORM |
| SQLite | — | Base de datos local |

---

## Licencia

Desarrollado por Keury. Presentado como proyecto académico en el Politécnico Loyola.
MD3 - Liga Deportiva con Base de datos relacionales
[MIT](LICENSE) — libre para siempre.
