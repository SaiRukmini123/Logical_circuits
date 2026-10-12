
# BOOL( ) CIRCUIT

**Feed it a function. Get back the whole circuit.** 

BOOL( ) CIRCUIT is an interactive, web-based educational tool designed to evaluate, simplify, and visualize digital logic circuits. Whether you are working with raw Boolean expressions, truth tables, minterms, or maxterms, this application automatically simplifies the logic and generates the corresponding gate level circuit diagrams. 

Built for the **(EE1202) Digital Circuits** course at the **Indian Institute of Technology Hyderabad (IITH)**.

---

## Features

* **Multiple Input Methods:** Enter logic via Boolean expressions, truth tables, minterms (Σm), or maxterms (ΠM).
* **Advanced Simplification:** Implements the Quine McCluskey algorithm and Petrick's method for exact minimum cover simplification.
* **Universal Gate Conversion:** Automatically converts and renders your basic logic circuit into **NAND only** and **NOR only** universal gate implementations.
* **Arithmetic Circuits Module:**
  * **Adders:** Configurable Half Adders, Full Adders, and multi bit Ripple Carry chains.
  * **Subtractors:** Configurable Half/Full Subtractors and Ripple-Borrow chains.
  * **Multipliers:** Visualizes partial products (shift & add) and the resulting adder tree.
* **Live SVG Rendering:** Gate networks are built using a custom Directed Acyclic Graph (DAG) layout engine to draw clean, readable SVG diagrams dynamically.
* **Theme Support:** Fully responsive UI with a built in Light/Dark mode toggle.

## Technologies Used

This project is built entirely with vanilla web technologies. No external UI libraries or dependencies were used.

* **HTML5:** Semantic structure and accessible forms.
* **CSS3:** Custom CSS variables for theming, CSS Grid/Flexbox for layout, and fully responsive design.
* **JavaScript (ES6+):** Vanilla JS handles the expression tokenization/parsing, Quine McCluskey logic reduction, DAG layout calculations, and dynamic SVG generation.

## Getting Started

Since this is a static frontend application, no build tools or servers are required.

### Option 1: Live Demo
You can view the live deployment of this project here: 
> **[Live Demo on Netlify](https://spectacular-kitsune-be025e.netlify.app)**

### Option 2: Run Locally
1. Clone the repository to your local machine:
   ```bash
   git clone [https://github.com/SaiRukmini123/Logical_circuits.git](https://github.com/SaiRukmini123/Logical_circuits.git)
