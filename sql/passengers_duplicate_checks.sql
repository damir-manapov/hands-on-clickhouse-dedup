-- Тестовые запросы для поиска дубликатов в таблицах passengers и passengerDocuments

-- 1) Поиск дубликатов по firstname + lastname + patronymic
SELECT
    firstname,
    lastname,
    patronymic,
    count() AS duplicates_count
FROM passengers
GROUP BY
    firstname,
    lastname,
    patronymic
HAVING count() > 1
ORDER BY duplicates_count DESC, firstname, lastname, patronymic;

-- 2) Поиск дубликатов по firstname + lastname + patronymic + passportNumber
-- passportNumber хранится в passengerDocuments.docNumber для docType = 'passport'
SELECT
    p.firstname,
    p.lastname,
    p.patronymic,
    d.docNumber AS passportNumber,
    uniqExact(p.id) AS duplicate_passengers_count,
    count() AS matched_rows_count
FROM passengers AS p
INNER JOIN passengerDocuments AS d
    ON p.id = d.passengerId
   AND d.docType = 'passport'
GROUP BY
    p.firstname,
    p.lastname,
    p.patronymic,
    d.docNumber
HAVING uniqExact(p.id) > 1
ORDER BY duplicate_passengers_count DESC, p.firstname, p.lastname, p.patronymic, passportNumber;

-- 3) Потенциальные дубликаты с одной ошибкой в firstname
-- Логика:
--   - lastname и patronymic полностью совпадают
--   - firstname отличается ровно на 1 символ (levenshteinDistanceUTF8 = 1)
--   - сравнение ведется по агрегированным группам, чтобы избежать N x N по исходной таблице
WITH names_agg AS (
    SELECT
        firstname,
        lastname,
        patronymic,
        count() AS records_count
    FROM passengers
    GROUP BY
        firstname,
        lastname,
        patronymic
)
SELECT
    a.lastname,
    a.patronymic,
    a.firstname AS firstname_variant_1,
    b.firstname AS firstname_variant_2,
    levenshteinDistanceUTF8(a.firstname, b.firstname) AS name_distance,
    a.records_count AS variant_1_count,
    b.records_count AS variant_2_count,
    a.records_count + b.records_count AS total_possible_duplicates
FROM names_agg AS a
INNER JOIN names_agg AS b
    ON a.lastname = b.lastname
   AND a.patronymic = b.patronymic
   AND a.firstname < b.firstname
WHERE levenshteinDistanceUTF8(a.firstname, b.firstname) = 1
ORDER BY total_possible_duplicates DESC, lastname, patronymic, firstname_variant_1, firstname_variant_2;

-- 4) Потенциальные дубликаты с двумя ошибками в firstname
-- Условие: lastname и patronymic совпадают, firstname отличается ровно на 2 символа
WITH names_agg AS (
    SELECT
        firstname,
        lastname,
        patronymic,
        count() AS records_count
    FROM passengers
    GROUP BY
        firstname,
        lastname,
        patronymic
)
SELECT
    a.lastname,
    a.patronymic,
    a.firstname AS firstname_variant_1,
    b.firstname AS firstname_variant_2,
    levenshteinDistanceUTF8(a.firstname, b.firstname) AS name_distance,
    a.records_count AS variant_1_count,
    b.records_count AS variant_2_count,
    a.records_count + b.records_count AS total_possible_duplicates
FROM names_agg AS a
INNER JOIN names_agg AS b
    ON a.lastname = b.lastname
   AND a.patronymic = b.patronymic
   AND a.firstname < b.firstname
WHERE levenshteinDistanceUTF8(a.firstname, b.firstname) = 2
ORDER BY total_possible_duplicates DESC, lastname, patronymic, firstname_variant_1, firstname_variant_2;

-- 5) Потенциальные дубликаты с тремя ошибками в firstname
-- Условие: lastname и patronymic совпадают, firstname отличается ровно на 3 символа
WITH names_agg AS (
    SELECT
        firstname,
        lastname,
        patronymic,
        count() AS records_count
    FROM passengers
    GROUP BY
        firstname,
        lastname,
        patronymic
)
SELECT
    a.lastname,
    a.patronymic,
    a.firstname AS firstname_variant_1,
    b.firstname AS firstname_variant_2,
    levenshteinDistanceUTF8(a.firstname, b.firstname) AS name_distance,
    a.records_count AS variant_1_count,
    b.records_count AS variant_2_count,
    a.records_count + b.records_count AS total_possible_duplicates
FROM names_agg AS a
INNER JOIN names_agg AS b
    ON a.lastname = b.lastname
   AND a.patronymic = b.patronymic
   AND a.firstname < b.firstname
WHERE levenshteinDistanceUTF8(a.firstname, b.firstname) = 3
ORDER BY total_possible_duplicates DESC, lastname, patronymic, firstname_variant_1, firstname_variant_2;

-- 6) Потенциальные дубликаты с 1 ошибкой на все поля ФИО суммарно
-- Условие: levenshtein(firstname)+levenshtein(lastname)+levenshtein(patronymic) = 1
WITH names_agg AS (
    SELECT
        firstname,
        lastname,
        patronymic,
        count() AS records_count
    FROM passengers
    GROUP BY
        firstname,
        lastname,
        patronymic
)
SELECT
    a.firstname AS firstname_variant_1,
    a.lastname AS lastname_variant_1,
    a.patronymic AS patronymic_variant_1,
    b.firstname AS firstname_variant_2,
    b.lastname AS lastname_variant_2,
    b.patronymic AS patronymic_variant_2,
    levenshteinDistanceUTF8(a.firstname, b.firstname) AS firstname_distance,
    levenshteinDistanceUTF8(a.lastname, b.lastname) AS lastname_distance,
    levenshteinDistanceUTF8(a.patronymic, b.patronymic) AS patronymic_distance,
    (
        levenshteinDistanceUTF8(a.firstname, b.firstname)
      + levenshteinDistanceUTF8(a.lastname, b.lastname)
      + levenshteinDistanceUTF8(a.patronymic, b.patronymic)
    ) AS total_distance,
    a.records_count AS variant_1_count,
    b.records_count AS variant_2_count,
    a.records_count + b.records_count AS total_possible_duplicates
FROM names_agg AS a
INNER JOIN names_agg AS b
    ON (a.lastname, a.firstname, a.patronymic) < (b.lastname, b.firstname, b.patronymic)
WHERE (
        levenshteinDistanceUTF8(a.firstname, b.firstname)
      + levenshteinDistanceUTF8(a.lastname, b.lastname)
      + levenshteinDistanceUTF8(a.patronymic, b.patronymic)
      ) = 1
ORDER BY total_possible_duplicates DESC, total_distance, lastname_variant_1, firstname_variant_1, patronymic_variant_1;

-- 8) Дубликаты по firstname + docType + docNumber (только паспорт)
SELECT
    p.firstname,
    d.docType,
    d.docNumber,
    uniqExact(p.id) AS duplicate_passengers_count,
    count() AS matched_rows_count
FROM passengers AS p
INNER JOIN passengerDocuments AS d
    ON p.id = d.passengerId
WHERE d.docType = 'passport'
GROUP BY
    p.firstname,
    d.docType,
    d.docNumber
HAVING uniqExact(p.id) > 1
ORDER BY duplicate_passengers_count DESC, p.firstname, d.docType, d.docNumber;

-- 9) Дубликаты по firstname + lastname + docType + docNumber (только паспорт)
SELECT
    p.firstname,
    p.lastname,
    d.docType,
    d.docNumber,
    uniqExact(p.id) AS duplicate_passengers_count,
    count() AS matched_rows_count
FROM passengers AS p
INNER JOIN passengerDocuments AS d
    ON p.id = d.passengerId
WHERE d.docType = 'passport'
GROUP BY
    p.firstname,
    p.lastname,
    d.docType,
    d.docNumber
HAVING uniqExact(p.id) > 1
ORDER BY duplicate_passengers_count DESC, p.firstname, p.lastname, d.docType, d.docNumber;

-- 10) Потенциальные дубликаты: firstname с 1 ошибкой + одинаковые docType и docNumber (только паспорт)
-- Логика:
--   - внутри одного (docType, docNumber) сравниваются варианты firstname
--   - levenshteinDistanceUTF8(firstname_1, firstname_2) = 1
WITH name_doc_agg AS (
    SELECT
        p.firstname,
        d.docType,
        d.docNumber,
        count() AS records_count
    FROM passengers AS p
    INNER JOIN passengerDocuments AS d
        ON p.id = d.passengerId
    WHERE d.docType = 'passport'
    GROUP BY
        p.firstname,
        d.docType,
        d.docNumber
)
SELECT
    a.docType,
    a.docNumber,
    a.firstname AS firstname_variant_1,
    b.firstname AS firstname_variant_2,
    levenshteinDistanceUTF8(a.firstname, b.firstname) AS firstname_distance,
    a.records_count AS variant_1_count,
    b.records_count AS variant_2_count,
    a.records_count + b.records_count AS total_possible_duplicates
FROM name_doc_agg AS a
INNER JOIN name_doc_agg AS b
    ON a.docType = b.docType
   AND a.docNumber = b.docNumber
   AND a.firstname < b.firstname
WHERE levenshteinDistanceUTF8(a.firstname, b.firstname) = 1
ORDER BY total_possible_duplicates DESC, a.docType, a.docNumber, firstname_variant_1, firstname_variant_2;

-- 7) Потенциальные дубликаты: возможна 1 ошибка в каждом поле ФИО
-- Условие: в firstname/lastname/patronymic расстояние Левенштейна <= 1,
--          и хотя бы одно поле отличается
WITH names_agg AS (
    SELECT
        firstname,
        lastname,
        patronymic,
        count() AS records_count
    FROM passengers
    GROUP BY
        firstname,
        lastname,
        patronymic
)
SELECT
    a.firstname AS firstname_variant_1,
    a.lastname AS lastname_variant_1,
    a.patronymic AS patronymic_variant_1,
    b.firstname AS firstname_variant_2,
    b.lastname AS lastname_variant_2,
    b.patronymic AS patronymic_variant_2,
    levenshteinDistanceUTF8(a.firstname, b.firstname) AS firstname_distance,
    levenshteinDistanceUTF8(a.lastname, b.lastname) AS lastname_distance,
    levenshteinDistanceUTF8(a.patronymic, b.patronymic) AS patronymic_distance,
    (
        levenshteinDistanceUTF8(a.firstname, b.firstname)
      + levenshteinDistanceUTF8(a.lastname, b.lastname)
      + levenshteinDistanceUTF8(a.patronymic, b.patronymic)
    ) AS total_distance,
    a.records_count AS variant_1_count,
    b.records_count AS variant_2_count,
    a.records_count + b.records_count AS total_possible_duplicates
FROM names_agg AS a
INNER JOIN names_agg AS b
    ON (a.lastname, a.firstname, a.patronymic) < (b.lastname, b.firstname, b.patronymic)
WHERE levenshteinDistanceUTF8(a.firstname, b.firstname) <= 1
  AND levenshteinDistanceUTF8(a.lastname, b.lastname) <= 1
  AND levenshteinDistanceUTF8(a.patronymic, b.patronymic) <= 1
  AND (
      levenshteinDistanceUTF8(a.firstname, b.firstname)
    + levenshteinDistanceUTF8(a.lastname, b.lastname)
    + levenshteinDistanceUTF8(a.patronymic, b.patronymic)
  ) > 0
ORDER BY total_possible_duplicates DESC, total_distance, lastname_variant_1, firstname_variant_1, patronymic_variant_1;
