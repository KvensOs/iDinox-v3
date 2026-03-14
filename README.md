<div align="center">

# iDinox v3

**El sistema de gestión de ligas para HaxBall.**
Todo desde Discord. Sin planillas. Sin trabajo manual cada temporada.

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

Llega un punto donde el DT no sabe si el jugador ya está registrado, las stats están en un canal que nadie encuentra, y el admin tiene que hacer todo a mano cuando empieza una temporada nueva. Datos dispersos, jugadores duplicados, historial perdido.

iDinox no intenta ser un bot genérico. Es un sistema pensado para ligas serias, donde cada fichaje, estadística y premio queda registrado y es consultable en cualquier momento, por siempre.

---

## Qué hace

- Gestiona **equipos** completos con logo, uniformes, DT y abreviación
- Controla el **mercado de fichajes** con notificaciones automáticas en canales dedicados
- Registra **estadísticas** por jugador, competencia y temporada — sin mezclarlas nunca
- Muestra **perfiles** con historial completo y navegación interactiva
- Soporta **múltiples modalidades** (X4, X5…) completamente independientes entre sí
- Preserva el **historial** aunque equipos o competencias se eliminen
- Todo con **slash commands** y autocomplete dinámico desde la base de datos

---

## Instalación

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/idinox-v3.git
cd idinox-v3

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# → editar .env con tu token de Discord y client ID

# Seed inicial (crea X4, X5 y Temporada 1)
npx tsx src/scripts/seed.ts

# Iniciar
npx tsx src/index.ts
```

Una vez arriba, lo primero es configurar cada modalidad con `/setup` desde Discord.

---

## Configuración inicial

Antes de cualquier cosa, hay que decirle al bot qué roles y canales usar en cada modalidad:

```
/setup modalidad:X4 campo:rol_admin              → @Admin X4
/setup modalidad:X4 campo:rol_dt                 → @Director Técnico
/setup modalidad:X4 campo:rol_estadistiquero     → @Estadistiquero
/setup modalidad:X4 campo:canal_logs             → #logs-x4
/setup modalidad:X4 campo:canal_mercado_fichajes → #fichajes-x4
/setup modalidad:X4 campo:canal_mercado_bajas    → #bajas-x4
```

Sin esto, los comandos de permisos y mercado no van a funcionar.

---

## Comandos

### Configuración y equipos

| Comando                      | Qué hace                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/setup`                     | Configura roles y canales de una modalidad. Sin argumentos muestra la configuración actual.                             |
| `/start`                     | Te registra en la temporada activa de una modalidad. Hay que repetirlo en cada temporada nueva.                         |
| `/league-team add`           | Crea un equipo, descarga el logo y registra al DT automáticamente.                                                      |
| `/league-team edit`          | Edita nombre, abreviación, rol o uniformes. Si cambia la abreviación, renombra el logo y actualiza todos los nicknames. |
| `/league-team delete`        | Soft delete: desactiva el equipo y libera el rol. Preserva todo el historial.                                           |
| `/league-competition new`    | Crea una competencia en la temporada activa. Puede asignar o crear un canal de estadísticas automáticamente.            |
| `/league-competition edit`   | Edita nombre, tipo o canal de estadísticas.                                                                             |
| `/league-competition close`  | Cierra sin borrar. Las stats quedan intactas.                                                                           |
| `/league-competition delete` | Elimina permanentemente junto con todas sus stats. Pide confirmación.                                                   |
| `/club-unis`                 | El DT o sub-DT edita los uniformes de su propio equipo.                                                                 |

### Mercado de fichajes

| Comando           | Qué hace                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `/market open`    | Abre el mercado de la modalidad.                                                                |
| `/market close`   | Cierra el mercado.                                                                              |
| `/market estado`  | Muestra si el mercado está abierto o cerrado. Público.                                          |
| `/market agents`  | Lista los jugadores sin equipo en la temporada activa.                                          |
| `/market sign`    | Ficha a un jugador: le asigna equipo, actualiza su nickname y notifica en el canal de fichajes. |
| `/market release` | Da de baja: desvincula del equipo, limpia el nickname y notifica en el canal de bajas.          |
| `/player-check`   | Muestra el estado de un jugador en todas las modalidades. Sin restricción de permisos.          |

### Estadísticas y perfiles

| Comando              | Qué hace                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `/league-stats add`  | Registra o corrige estadísticas manualmente con autocomplete de jugador y competencia.              |
| `/perfil`            | Perfil completo con stats por competencia, temporadas anteriores y premios. Navegación interactiva. |
| `/club`              | Ficha del equipo con plantilla, posiciones y stats de la temporada actual.                          |
| `/league-tops`       | Rankings por goles, asistencias, vallas y autogoles. Filtrable por competencia y temporada.         |
| `/league-compare`    | Comparativa directa entre dos jugadores. _(próximamente)_                                           |
| `/league-history`    | Palmarés y recorrido histórico de un jugador o equipo. _(próximamente)_                             |
| `/league-trophy add` | Registra un premio o título de equipo o individual. _(próximamente)_                                |

### Temporadas

| Comando        | Qué hace                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------- |
| `/season new`  | Crea una nueva temporada. Archiva la anterior y cierra sus competencias. _(próximamente)_ |
| `/season end`  | Cierra la temporada activa sin crear una nueva. _(próximamente)_                          |
| `/season info` | Info de la temporada activa o de cualquier temporada anterior. _(próximamente)_           |

### Utilidades

| Comando         | Qué hace                                                                   |
| --------------- | -------------------------------------------------------------------------- |
| `/broadcast`    | DM masivo a hasta 3 roles del servidor. _(próximamente)_                   |
| `/hora`         | Referencia de horarios para comunidades latinoamericanas. _(próximamente)_ |
| `/timestamp`    | Generador de timestamps para Discord. _(próximamente)_                     |
| `/ticket setup` | Sistema de tickets integrado. _(próximamente)_                             |

---

## Sistema de estadísticas

Las stats se pueden cargar de dos formas. Ambas requieren tener `rol_estadistiquero` o `rol_admin` de la modalidad.

### Canal por competencia

Esta es la forma rápida. Cada competencia puede tener un canal de Discord dedicado. El bot escucha los mensajes en ese canal y procesa todo automáticamente, sin necesidad de abrir ningún comando.

Al crear o editar una competencia con `/league-competition`, puedes:

- **Seleccionar un canal existente** — el bot configura los permisos automáticamente
- **Pedir que cree uno** con `crear_canal:True` — lo crea con nombre `stats-competencia-modalidad` y bloquea el acceso a `@everyone` directamente

Una vez configurado, la sintaxis es simple:

```
@Jugador g2 a1
@Jugador cs1
@Jugador g-1
```

| Código | Stat          |
| ------ | ------------- |
| `g`    | Goles         |
| `a`    | Asistencias   |
| `cs`   | Valla invicta |
| `ag`   | Autogol       |

Los valores negativos restan stats. Nunca pueden quedar en negativo — si el resultado sería menor a 0, se limita a 0 automáticamente y se avisa.

El bot responde con un embed confirmando los cambios y envía un log al `canal_logs` de la modalidad con el detalle de qué se modificó y quién lo hizo.

### Comando `/league-stats add`

La alternativa formal. Útil para correcciones puntuales o cuando no se tiene acceso al canal. Tiene autocomplete de jugador y competencia, y el mismo campo libre para escribir las stats:

```
/league-stats add modalidad:X4 competicion:Liga Apertura jugador:@Player stats:g2 a1
```

---

## Permisos

El sistema tiene tres niveles, todos configurables por modalidad:

| Nivel                  | Quién                             | Qué puede hacer                                           |
| ---------------------- | --------------------------------- | --------------------------------------------------------- |
| **Admin global**       | Administrador del servidor        | Todo, incluyendo cambiar `rol_admin` y crear temporadas.  |
| **Admin de modalidad** | Tiene `rol_admin` de la modalidad | Gestión de equipos, mercado, competencias y estadísticas. |
| **DT / Sub-DT**        | Tiene `rol_dt` o `rol_sub_dt`     | Fichajes de su propio equipo y uniformes.                 |
| **Estadistiquero**     | Tiene `rol_estadistiquero`        | Cargar stats por canal o comando.                         |

> El DT no se guarda en la base de datos. Se detecta dinámicamente: quien tiene `rol_dt` **y** pertenece al equipo en esa temporada es el DT. Cambiar de DT es simplemente reasignar el rol en Discord.

---

## Base de datos

El sistema usa **8 modelos** relacionales con SQLite y Sequelize.

```
Modality → Season → Competition
         → Team

Season → Participant ← Player
Team   → Participant

Participant → Stat ← Competition

Season  → Award
Modality → Award
```

| Modelo        | Qué representa                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Modality`    | Modalidad de juego (X4, X5…). Guarda toda la configuración de Discord en un campo JSON.                           |
| `Season`      | Temporada de una modalidad. X4 y X5 avanzan independientemente.                                                   |
| `Team`        | Equipo con logo, uniformes y rol de Discord. Soft delete para preservar historial.                                |
| `Player`      | Registro global del usuario de Discord. Un ID, un perfil. Independiente de temporada o modalidad.                 |
| `Participant` | **Nodo central.** Une un `Player` con un `Team` y una `Season+Modalidad`. `teamId = null` significa agente libre. |
| `Competition` | Liga, copa, amistoso u otro. Hereda la modalidad de su `Season`. Puede tener un canal de stats asignado.          |
| `Stat`        | Stats de un `Participant` en una `Competition` específica. Nunca se mezclan entre temporadas ni competencias.     |
| `Award`       | Premio o título de equipo o individual. Sobrevive aunque la competencia o el equipo se eliminen.                  |

### Multi-modalidad

X4 y X5 son universos completamente separados. Cada una tiene su propia configuración de roles y canales, sus equipos, temporadas, mercado y permisos. Conviven en el mismo servidor sin interferirse.

### Soft delete de equipos

Los equipos no se borran realmente. Al eliminar:

```
isActive = false
roleId   = "deleted_${id}"
```

El rol queda libre para usarse de nuevo. Las stats, participaciones y premios quedan intactos en la base de datos.

---

## Estructura del proyecto

```
idinox-v3/
├── src/
│   ├── commands/        # Slash commands
│   ├── core/            # Conexión a DB y cliente Discord
│   ├── database/
│   │   └── models/      # Modelos Sequelize
│   ├── events/          # messageCreate, interactionCreate, etc.
│   ├── utils/           # Logger, permisos, autocomplete, statsHelper
│   └── scripts/         # Seed y utilidades
└── logos/               # Logos de equipos (se genera automáticamente)
```

---

## Hoja de ruta

| Fase                        | Contenido                                                               | Estado           |
| --------------------------- | ----------------------------------------------------------------------- | ---------------- |
| 1 — Configuración y equipos | `/setup`, `/league-team`, `/league-competition`, `/start`, `/club-unis` | ✅ Completado    |
| 2 — Mercado de fichajes     | `/market`, `/player-check`                                              | ✅ Completado    |
| 3 — Estadísticas y perfiles | `/league-stats`, `/perfil`, `/club`, `/league-tops`, canal de stats     | 🔄 En desarrollo |
| 4 — Gestión de temporadas   | `/season new/end/info`                                                  | 📋 Planificado   |
| 5 — Utilidades              | `/broadcast`, `/hora`, `/timestamp`, `/ticket`                          | 📋 Planificado   |

---

## Stack

| Tecnología | Versión   | Uso                     |
| ---------- | --------- | ----------------------- |
| Node.js    | ≥ 18      | Runtime                 |
| TypeScript | 5.x (ESM) | Lenguaje principal      |
| Discord.js | v14       | Integración con Discord |
| Sequelize  | 6.x       | ORM                     |
| SQLite     | —         | Base de datos           |

---

## Licencia

[MIT](LICENSE) — libre para siempre.
