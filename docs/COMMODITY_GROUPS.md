# Commodity Groups Reference

The fixed list of commodity groups from the challenge README ([Additional Information → Commodity Groups](../README.md)). This is the single source of truth for:

- the commodity suggestion/classifier (it must pick from **this list only**),
- the UI override selector (users never need to browse it manually, but they can),
- storage (requests store the stable `ID`).

8 categories, 50 groups total.

## General Services

| ID  | Commodity Group                  |
|-----|-----------------------------------|
| 001 | Accommodation Rentals            |
| 002 | Membership Fees                  |
| 003 | Workplace Safety                 |
| 004 | Consulting                       |
| 005 | Financial Services               |
| 006 | Fleet Management                 |
| 007 | Recruitment Services             |
| 008 | Professional Development         |
| 009 | Miscellaneous Services           |
| 010 | Insurance                        |

## Facility Management

| ID  | Commodity Group                  |
|-----|-----------------------------------|
| 011 | Electrical Engineering           |
| 012 | Facility Management Services     |
| 013 | Security                         |
| 014 | Renovations                      |
| 015 | Office Equipment                 |
| 016 | Energy Management                |
| 017 | Maintenance                      |
| 018 | Cafeteria and Kitchenettes       |
| 019 | Cleaning                         |

## Publishing Production

| ID  | Commodity Group                  |
|-----|-----------------------------------|
| 020 | Audio and Visual Production      |
| 021 | Books/Videos/CDs                 |
| 022 | Printing Costs                   |
| 023 | Software Development for Publishing |
| 024 | Material Costs                   |
| 025 | Shipping for Production          |
| 026 | Digital Product Development      |
| 027 | Pre-production                   |
| 028 | Post-production Costs            |

## Information Technology

| ID  | Commodity Group                  |
|-----|-----------------------------------|
| 029 | Hardware                         |
| 030 | IT Services                      |
| 031 | Software                         |

## Logistics

| ID  | Commodity Group                  |
|-----|-----------------------------------|
| 032 | Courier, Express, and Postal Services |
| 033 | Warehousing and Material Handling |
| 034 | Transportation Logistics         |
| 035 | Delivery Services                |

## Marketing & Advertising

| ID  | Commodity Group                  |
|-----|-----------------------------------|
| 036 | Advertising                      |
| 037 | Outdoor Advertising              |
| 038 | Marketing Agencies               |
| 039 | Direct Mail                      |
| 040 | Customer Communication           |
| 041 | Online Marketing                 |
| 042 | Events                           |
| 043 | Promotional Materials            |

## Production

| ID  | Commodity Group                  |
|-----|-----------------------------------|
| 044 | Warehouse and Operational Equipment |
| 045 | Production Machinery             |
| 046 | Spare Parts                      |
| 047 | Internal Transportation          |
| 048 | Production Materials             |
| 049 | Consumables                      |
| 050 | Maintenance and Repairs          |

## Usage examples

The sample offer from the README would map as follows:

| Input | Suggested group | Why |
|-------|-----------------|-----|
| "Adobe Creative Cloud Subscription", order lines for Photoshop/Illustrator licenses, department "Creative Marketing" | Category `Information Technology`, ID `031` — Software | Subscription software licenses; Marketing & Advertising would fit the department, but the item type is software |
| Office chairs from a furniture vendor | ID `015` — Office Equipment | Facility Management |
| A consultancy engagement for process optimization | ID `004` — Consulting | General Services |