<div align="center">

# iDinox v3

**El sistema de gestión de ligas para HaxBall.**
Todo desde Discord. Sin planillas. Sin trabajo manual.

[![Node](https://img.shields.io/badge/node-%3E=18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.js.org)
[![SQLite](https://img.shields.io/badge/sqlite-sequelize-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://sequelize.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/estado-en%20desarrollo-f59e0b?style=flat-square)]()

</div>

---

## El problema

Las ligas de HaxBall crecen. Las planillas de Google Sheets, no.

En algún punto siempre pasa lo mismo: datos de fichajes en un canal, stats en otro, el DT que no sabe si el jugador ya está registrado, el admin que tiene que hacer todo a mano cada temporada nueva. Información dispersa, jugadores duplicados, historial perdido.

iDinox nació para resolver exactamente eso. No es un bot genérico con mil funciones. Es un sistema pensado específicamente para organizar ligas serias, donde la historia de cada jugador, equipo y temporada queda guardada y es consultable en cualquier momento.

---

## Qué hace

- Gestiona **equipos** completos: logo, uniformes, DT, abreviación
- Controla el **mercado de fichajes** con notificaciones automáticas
- Registra **estadísticas** por jugador, competencia y temporada
- Muestra **perfiles** con historial completo
- Soporta **múltiples modalidades** (X4, X5, etc.) totalmente independientes entre sí
- Preserva el **historial** aunque equipos o competencias se eliminen
- Todo con **slash commands** y autocomplete dinámico

---

## Stack

| Tecnología | Uso |
|---|---|
| Node.js + TypeScript (ESM) | Runtime principal |
| Discord.js v14 | Integración con Discord |
| Sequelize | ORM |
| SQLite | Base de datos |

```
npx tsx src/index.ts
```

---

## Instalación

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/idinox-v3.git
cd idinox-v3

# Instalar dependencias
npm install

# Copiar y configurar variables de entorno
cp .env.example .env
# → editar .env con tu token de Discord y client ID

# Correr el seed inicial
npx tsx src/scripts/seed.ts

# Iniciar el bot
npx tsx src/index.ts
```

El seed crea las modalidades `X4` y `X5` con su primera temporada activa. A partir de ahí todo se configura desde Discord con `/setup`.

---

## Estructura del proyecto

```
idinox-v3/
├── src/
│   ├── commands/        # Slash commands organizados por categoría
│   ├── core/            # Conexión a base de datos, cliente de Discord
│   ├── database/
│   │   └── models/      # Modelos Sequelize
│   ├── events/          # Handlers de eventos (interactionCreate, messageCreate, etc.)
│   ├── utils/           # Logger, permisos, autocomplete, helpers
│   └── scripts/         # Seed y utilidades de mantenimiento
└── logos/               # Logos de equipos (se crea automáticamente)
```

---

## Base de datos

El sistema gira en torno a **8 modelos** relacionales.

```
Modality → Season → Competition
         → Team

Season → Participant ← Player
Team   → Participant

Participant → Stat ← Competition

Season → Award
```

| Modelo | Qué representa |
|---|---|
| `Modality` | Modalidad de juego (X4, X5…). Guarda toda la configuración de Discord en un campo JSON. |
| `Season` | Temporada de una modalidad. Cada modalidad tiene sus propias temporadas independientes. |
| `Team` | Equipo con logo, uniformes y rol de Discord. Soft delete para preservar historial. |
| `Player` | Registro global del usuario. Un Discord ID, un perfil. Independiente de temporada o modalidad. |
| `Participant` | **Nodo central.** Une un `Player` con un `Team` y una `Season`. `teamId = null` → agente libre. Índice único sobre `(playerId, seasonId, modalityId)`. |
| `Competition` | Liga, copa, amistoso u otro. Hereda la modalidad de su `Season`. |
| `Stat` | Stats de un `Participant` en una `Competition` específica. Nunca se mezclan entre temporadas. |
| `Award` | Premio o título. Puede ser de equipo o individual. Sobrevive aunque la competencia se elimine. |

### Multi-modalidad

X4 y X5 son universos completamente separados. Cada una tiene su propia configuración de canales y roles, sus propios equipos, temporadas, mercado y permisos. Conviven en el mismo servidor sin interferirse.

### Soft delete

Los equipos no se borran realmente. Al eliminar un equipo:
```
isActive = false
roleId   = "deleted_${id}"
```
El rol de Discord queda libre para usarse de nuevo. Las stats, participaciones y premios del equipo siguen en la base de datos intactos.

---

## Configuración inicial

Antes de usar cualquier comando, hay que configurar la modalidad con `/setup`:

```
/setup modalidad:X4 campo:rol_dt           → @Director Técnico
/setup modalidad:X4 campo:rol_admin        → @Admin X4
/setup modalidad:X4 campo:canal_logs       → #logs-x4
/setup modalidad:X4 campo:canal_mercado_fichajes → #fichajes-x4
```

Sin configuración, los comandos de mercado y permisos no funcionan.

---

## Comandos

### Configuración y equipos

| Comando | Qué hace |
|---|---|
| `/setup` | Configura roles y canales de una modalidad. Sin argumentos muestra la config actual. |
| `/start` | Registra al jugador en la temporada activa de una modalidad. Hay que repetirlo en cada temporada nueva. |
| `/league-team add` | Crea un equipo, descarga el logo y asigna DT automáticamente. |
| `/league-team edit` | Edita nombre, abreviación, rol o uniformes. Renombra el logo y actualiza nicknames si cambia la abreviación. |
| `/league-team delete` | Soft delete. Libera el rol y a todos los jugadores del equipo. |
| `/league-competition new` | Crea una competencia (liga, copa, amistoso…) en la temporada activa. |
| `/league-competition edit` | Edita nombre o tipo. |
| `/league-competition close` | Cierra sin borrar. Preserva todas las stats. |
| `/league-competition delete` | Elimina permanentemente. Borra stats en cascada. |
| `/club-unis` | El DT o sub-DT edita los uniformes de su equipo. |

### Mercado de fichajes

| Comando | Qué hace |
|---|---|
| `/market open` | Abre el mercado de la modalidad. |
| `/market close` | Cierra el mercado. |
| `/market estado` | Muestra si el mercado está abierto o cerrado. |
| `/market agents` | Lista los jugadores sin equipo en la temporada activa. |
| `/market sign` | Ficha un jugador: asigna equipo, actualiza nickname, notifica en el canal de fichajes. |
| `/market release` | Da de baja: desvincula del equipo, limpia nickname, notifica en el canal de bajas. |
| `/player-check` | Muestra el estado de un jugador en todas las modalidades. Sin restricción de permisos. |

### Estadísticas y perfil *(en desarrollo)*

| Comando | Qué hace |
|---|---|
| `/league-stats add` | Registra o corrige estadísticas manualmente. |
| `/perfil` | Perfil completo del jugador con stats por competencia y temporada. |
| `/club` | Ficha del equipo con plantilla, posiciones y stats actuales. |
| `/league-tops` | Rankings de goles, asistencias y tarjetas. |
| `/league-compare` | Comparativa directa entre dos jugadores. |
| `/league-history` | Palmarés y recorrido histórico de un jugador o equipo. |
| `/league-trophy add` | Registra un premio o título. |

### Temporadas *(planificado)*

| Comando | Qué hace |
|---|---|
| `/season new` | Nueva temporada. Archiva la anterior y cierra sus competencias en cascada. |
| `/season end` | Cierra la temporada activa sin crear una nueva. |
| `/season info` | Info de la temporada activa o de cualquier temporada anterior. |

### Utilidades *(planificado)*

| Comando | Qué hace |
|---|---|
| `/broadcast` | DM masivo a hasta 3 roles del servidor. |
| `/hora` | Referencia de horarios para comunidades latinoamericanas. |
| `/timestamp` | Generador de timestamps para Discord. |
| `/ticket setup` | Sistema de tickets integrado. |
| `/upload` | Registro de grabaciones de partidos. |

---

## Sistema de estadísticas

Las stats se pueden cargar de dos formas.

### Canal por competencia

Cada `Competition` puede tener un canal de Discord asignado. El bot escucha los mensajes en ese canal y procesa las stats automáticamente.

Sintaxis:
```
@Jugador g2 a1
@Jugador cs1
@Jugador g-1 ag1
```

| Código | Stat |
|---|---|
| `g` | Goles |
| `a` | Asistencias |
| `cs` | Valla invicta |
| `ag` | Autogol |

Pueden mencionarse varios jugadores en el mismo mensaje. Responde con ✅ si todo está bien o ❌ con el error específico.

Permisos para cargar stats: `rol_estadistiquero`, `rol_dt` o `rol_admin`.

### Comando

```
/league-stats add jugador:@Player competencia:Liga Apertura g:2 a:1
```

Útil para correcciones o cuando no se tiene acceso al canal.

---

## Permisos

El sistema tiene tres niveles:

| Nivel | Quién | Qué puede hacer |
|---|---|---|
| Admin global | Administrador del servidor | Todo. Incluyendo cambiar `rol_admin` y crear temporadas. |
| Admin de modalidad | Tiene `rol_admin` de la modalidad | Gestión de equipos, mercado, competencias, premios. |
| DT / Sub-DT | Tiene `rol_dt` o `rol_sub_dt` | Fichajes de su equipo, uniformes, bajas. |

El DT no se guarda en la base de datos. Se detecta dinámicamente: quien tiene `rol_dt` **y** pertenece al equipo es el DT. Cambiar de DT es solo cambiar el rol en Discord.

---

## Diseño y decisiones técnicas

**Participant es el nodo central.**
Un `Participant` existe por cada combinación de `(playerId, seasonId, modalityId)`. Un jugador puede estar en X4 y X5 al mismo tiempo. Sus stats y equipos son completamente independientes en cada modalidad.

**Temporadas independientes por modalidad.**
X4 puede estar en Temporada 3 mientras X5 arranca su Temporada 1. Cada una avanza a su ritmo.

**Autocomplete dinámico desde la base de datos.**
Los campos de modalidad, equipo y competencia en los comandos se cargan en tiempo real. No hay choices hardcodeadas. Agregar una modalidad nueva la hace disponible al instante sin tocar código.

**`Player.findOrCreate` en vez de `findOne`.**
Los DTs creados por `/league-team add` pueden no haber usado nunca `/start`. `findOrCreate` garantiza que su registro de `Player` existe sin romper el flujo.

**Competition hereda modalidad de Season.**
Las competencias no tienen `modalityId` propio, lo heredan del `Season` al que pertenecen. Una fuente de verdad, sin datos duplicados ni posibles inconsistencias.

---

## Hoja de ruta

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Configuración, equipos y competencias | ✅ completado |
| 2 | Mercado de fichajes | ✅ completado |
| 3 | Estadísticas, perfiles y palmarés | 🔄 en desarrollo |
| 4 | Gestión de temporadas | 📋 planificado |
| 5 | Utilidades generales | 📋 planificado |

---

## Licencia

[MIT](LICENSE) — libre para siempre.
