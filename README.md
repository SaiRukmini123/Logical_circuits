# BOOL( ) CIRCUIT

Feed it a function, get back the circuit.

BOOL( ) CIRCUIT is a web tool for digital logic circuits. Give it a Boolean expression, truth table, minterms, or maxterms, and it simplifies the logic before generating the complete gate level circuit diagrams.

Built for the EE1202 Digital Circuits course at IIT Hyderabad.

## Features

- **Multiple Input Types:** Supports Boolean expressions, truth tables, minterms (Σm), and maxterms (ΠM).
- **Logic Simplification:** Uses the Quine McCluskey algorithm and Petrick's method to get the minimum logic representation.
- **Universal Gates:** Automatically converts basic logic into NAND only and NOR only circuits.
- **Arithmetic Modules:**
  * **Adders:** Half Adders, Full Adders, and multi bit Ripple Carry chains.
  * **Subtractors:** Half/Full Subtractors and Ripple Borrow chains.
  * **Multipliers:** Shows partial products (shift and add) alongside the adder tree.
- **SVG Diagrams:** Dynamically draws readable circuit diagrams right in the browser.
- **Theme Support:** Includes a toggle for Light and Dark mode.

## Tech Stack

Built with plain web technologies, no external frameworks or npm dependencies required.

- **HTML5:** Form controls and document layout.
- **CSS3:** Custom themes with CSS variables, Grid, and Flexbox layouts.
- **JavaScript (ES6+):** Handles expression parsing, logic reduction, SVG diagram generation, and arithmetic simulation.

## How to Run

Since this is a static frontend project, you don't need to install any packages or build tools.

1. Clone the repository to your computer:
   ```bash
   git clone [https://github.com/SaiRukmini123/Logical_circuits.git](https://github.com/SaiRukmini123/Logical_circuits.git)
