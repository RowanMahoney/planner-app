# Planner

A local-first project management tool for planning work across teams, tracking tasks through phases, and visualising timelines on an interactive Gantt chart. Built with vanilla JavaScript -- no frameworks, no build step.

## Features

### Views

- **Project View** -- Hierarchical Gantt chart with collapsible rows (Project Group > Project > Phase > Stage > Task). Zoom, pan, and fit-to-view controls. Drag bars to reschedule; resize to adjust duration. Bars snap to month boundaries.
- **Board View** -- Kanban-style board with draggable task cards organised by bucket (e.g. To Do, In Progress, Done).
- **Validation Actions** -- Dedicated tab for managing validation action descriptions. Actions assigned to tasks are automatically surfaced here.

### Task Management

- Create, edit, and delete tasks with title, description, priority, dates, progress, checklist, assignees, and labels
- Slide-out task detail panel for editing all fields including Australian-format date pickers (DD/MM/YYYY)
- Validation action IDs can be attached to tasks and appear as red badges on Gantt bars
- Assign tasks to projects, phases, and stages

### Financial Year Timeline

The Gantt timeline follows NAB's financial year (1 October -- 30 September):

| Quarter | Months |
|---------|--------|
| Q1 | Oct -- Dec |
| Q2 | Jan -- Mar |
| Q3 | Apr -- Jun |
| Q4 | Jul -- Sep |

FY boundaries are shown as solid lines; quarter boundaries as dashed lines.

### Organisation

- **Project Groups** -- top-level grouping of related projects
- **Projects** -- collections of tasks with phase-coloured summary bars
- **Phases** -- pipelines with configurable stages (e.g. Development, Validation, Implementation)
- **Team Members** -- assignable to tasks, shown as avatars
- **Labels** -- colour-coded tags for categorisation

All names (members, labels, projects, project groups, phases) are editable via the sidebar or project hierarchy.

### Export

- **HTML** -- printable/PDF-ready Gantt export with FY/quarter demarcation lines and legend
- **JSON** -- full project data for backup or sharing
- **CSV** -- task data in tabular format

### Themes

Dark and light themes, toggled from the sidebar.

## Getting Started

### Quick Start

Open `index.html` in a browser. No server required for basic use.

### With File Save-Back

The File System Access API allows saving directly back to a JSON file, but requires a secure context:

```bash
# Using Node.js
npx http-server

# Using Python
python -m http.server
```

Then open `http://localhost:8080` (or the port shown).

On Windows, `launch.bat` opens Chrome with flags that enable the File System API on `file://` URLs.

### Sample Data

Click **Load Sample Project** on the welcome screen, or drop any exported JSON file onto the import area.

## Project Structure

```
planner/
  index.html          Single-page entry point
  launch.bat          Windows launcher (Chrome + FS API flags)
  data/
    sample-project.json
  css/
    main.css          Core layout, theme variables, sidebar, task panel
    board.css         Kanban board styles
    gantt.css         Gantt chart and timeline styles
    modal.css         Modal dialog and form styles
  js/
    store.js          Data store, CRUD, events, import/export, auto-save
    app.js            App controller, view switching, sidebar, filters
    board.js          Board view rendering and drag-and-drop
    project.js        Gantt view, timeline, hierarchy, export
    taskPanel.js      Slide-out task editor panel
    modal.js          Reusable modal dialog system
```

## Data Storage

| Method | Purpose |
|--------|---------|
| **localStorage** | Automatic persistence between sessions |
| **File System Access API** | Read/write to a local JSON file with auto-save every 30s |
| **IndexedDB** | Persists file handle across page reloads |

Data is stored as a single JSON structure containing tasks, buckets, pipelines, members, labels, groups, project groups, and validation action definitions.

## Tech Stack

- Vanilla JavaScript (ES2020+, no dependencies)
- HTML5 / CSS3 with custom properties for theming
- Web APIs: localStorage, IndexedDB, File System Access, Print
