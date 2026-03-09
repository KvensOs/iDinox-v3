# iDinox v3

![Node](https://img.shields.io/badge/node-%3E=18-green)
![TypeScript](https://img.shields.io/badge/language-typescript-blue)
![Discord.js](https://img.shields.io/badge/discord.js-v14-5865F2)
![Database](https://img.shields.io/badge/database-sqlite-lightgrey)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-in%20development-orange)

**Open source · gratuito · hecho para HaxBall**

La liga sin la planilla de **Google Sheets**.
Todo en Discord. Sin costo. Sin trabajo manual cada temporada.

Equipos, fichajes, estadísticas y temporadas gestionados directamente desde el bot.

---

# ¿Qué es iDinox?

iDinox no intenta ser un bot genérico.

Es un **sistema completo de gestión de ligas** para comunidades de HaxBall.

Nació de un problema muy común:
ligas organizadas con **planillas, mensajes sueltos y datos dispersos**.

Eso funciona… hasta que la liga crece.

Entonces empiezan los problemas:

* datos perdidos
* jugadores duplicados
* temporadas mezcladas
* admins haciendo todo a mano

iDinox centraliza todo.

Cada inscripción, fichaje, estadística o premio queda registrado en una **base de datos relacional**, preservando la historia completa de la liga.

---

# Características

* Gestión completa de **equipos**
* **Mercado de fichajes**
* **Estadísticas por jugador**
* **Perfiles de jugador**
* **Historial de temporadas**
* **Premios y palmarés**
* **Multi-modalidad (X4, X5, etc)**
* **Soft delete** para preservar historial

---

# Stack

* Node.js
* TypeScript
* Discord.js v14
* Sequelize
* SQLite

Runtime:

```bash
npx tsx src/index.ts
```

Seed inicial:

```bash
npx tsx src/scripts/seed.ts
```

---

# Estructura del proyecto

```
src/
 ├ commands/
 ├ core/
 ├ database/
 │   └ models/
 ├ events/
 ├ utils/
 └ scripts/

logos/
```

Los logos de equipos se guardan automáticamente en la carpeta `logos/`.

---

# Base de datos

El sistema utiliza **8 modelos principales**.

| Modelo      | Descripción                                  |
| ----------- | -------------------------------------------- |
| Modality    | Modalidad de juego (X4, X5, etc)             |
| Season      | Temporada de una modalidad                   |
| Team        | Equipos                                      |
| Player      | Usuario global de Discord                    |
| Participant | Participación de un jugador en una temporada |
| Competition | Ligas, copas o torneos                       |
| Stat        | Estadísticas por jugador                     |
| Award       | Premios y títulos                            |

Relaciones principales:

```
Modality → Season → Competition
Modality → Team

Season → Participant ← Player
Team → Participant

Participant → Stat ← Competition

Season → Award
Modality → Award
```

`Participant` es el nodo central: conecta jugador, equipo y temporada.

---

# Comandos principales

| Comando               | Descripción                                |
| --------------------- | ------------------------------------------ |
| `/setup`              | Configura roles y canales de una modalidad |
| `/start`              | Registra un jugador en la temporada actual |
| `/league-team add`    | Crear equipo                               |
| `/league-team edit`   | Editar equipo                              |
| `/league-team delete` | Eliminar equipo (soft delete)              |
| `/market open`        | Abrir mercado                              |
| `/market close`       | Cerrar mercado                             |
| `/market agents`      | Listar agentes libres                      |
| `/market sign`        | Fichar jugador                             |
| `/market release`     | Liberar jugador                            |
| `/perfil`             | Perfil de jugador                          |
| `/club`               | Información de un equipo                   |

---

# Ejemplos de uso

Registrar jugador:

```
/start modalidad:X4 posicion:DEL
```

Crear equipo:

```
/league-team add modalidad:X4 nombre:"Dragons" abreviacion:DRG
```

Abrir mercado:

```
/market open modalidad:X4
```

Fichar jugador:

```
/market sign jugador:@Player equipo:Dragons
```

Consultar perfil:

```
/perfil jugador:@Player
```

---

# Sistema de estadísticas

Las stats pueden registrarse de dos formas.

## Canal de estadísticas

Cada competición puede tener un canal asignado.

Ejemplo:

```
@Jugador g2 a1
@Jugador cs1
@Jugador g-1
```

| Código | Significado   |
| ------ | ------------- |
| g      | goles         |
| a      | asistencias   |
| cs     | valla invicta |
| ag     | autogol       |

---

## Comando

```
/league-stats add
```

Permite registrar o corregir estadísticas manualmente.

---

# Roadmap

| Fase                    | Estado        |
| ----------------------- | ------------- |
| Configuración y equipos | completado    |
| Mercado de fichajes     | completado    |
| Estadísticas y perfiles | en desarrollo |
| Gestión de temporadas   | planificado   |
| Utilidades              | planificado   |

---

# Decisiones de arquitectura

### DT dinámico

No existe campo `dt` en `Team`.

El DT se determina por:

* rol `rol_dt`
* pertenencia al equipo

---

### Soft delete de equipos

Los equipos no se eliminan realmente.

```
isActive = false
roleId = deleted_${id}
```

Esto preserva historial de:

* stats
* premios
* temporadas

---

### Competitions sin modalityId

La modalidad se hereda desde `Season`.

Esto evita duplicación de datos.

---

### Participants por temporada

Cada temporada requiere registrar nuevamente al jugador:

```
/start
```

Esto crea su nuevo `Participant`.

---

# Seed inicial

El seed crea automáticamente:

Modalidades:

```
X4
X5
```

Temporada activa:

```
Temporada 1
```

---

# Licencia

MIT License

Este proyecto es **100 % open source y gratuito**.

---

# Sobre el proyecto

iDinox v3 está siendo desarrollado como una herramienta para comunidades de HaxBall que quieren organizar ligas de forma seria sin depender de herramientas externas.

El objetivo es simple:

**que toda la liga pueda gestionarse desde Discord.**
