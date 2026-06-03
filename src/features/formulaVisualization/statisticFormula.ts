import type { StatisticHighlight } from "../../graphTypes";

export type StatisticName = "MEAN" | "SD" | "VAR" | "COVAR" | "MEDIAN";

export type StatisticFormulaComponent = {
  id: StatisticHighlight;
  label: string;
  title: string;
  explanation: string;
};

export const STATISTIC_FORMULA_COMPONENTS: Record<StatisticName, StatisticFormulaComponent[]> = {
  MEAN: [
    {
      id: "mean-point",
      label: "(x̄, ȳ)",
      title: "Mean point",
      explanation: "Highlights the center point formed by the horizontal and vertical means.",
    },
    {
      id: "mean-x",
      label: "x̄ = Σxi / n",
      title: "Horizontal mean",
      explanation: "Highlights the vertical line at the average x value.",
    },
    {
      id: "mean-y",
      label: "ȳ = Σyi / n",
      title: "Vertical mean",
      explanation: "Highlights the horizontal line at the average y value.",
    },
  ],
  SD: [
    {
      id: "sd-center",
      label: "(x̄, ȳ)",
      title: "Mean center",
      explanation: "Highlights the mean x and mean y reference lines used for standard deviation.",
    },
    {
      id: "sd-y-deviations",
      label: "yi - ȳ",
      title: "Vertical deviations",
      explanation: "Vertical deviation = how far this point's y-value is from the mean y-value.",
    },
    {
      id: "sd-y-squares",
      label: "(yi - ȳ)²",
      title: "Squared vertical deviations",
      explanation: "Squared vertical deviation uses the vertical distance as the side length of a square.",
    },
    {
      id: "sd-y-sum",
      label: "Σ(yi - ȳ)²",
      title: "Total vertical squared spread",
      explanation: "Shows all vertical-deviation squares together as the accumulated squared vertical spread.",
    },
    {
      id: "sd-y-average",
      label: "VAR_y",
      title: "Average vertical squared deviation",
      explanation: "Shows the average squared vertical deviation area after dividing the total by n.",
    },
    {
      id: "sd-y-length",
      label: "√VAR_y",
      title: "Vertical standard deviation length",
      explanation: "√VAR converts the average squared deviation back into a normal distance from the mean.",
    },
    {
      id: "sd-x-deviations",
      label: "xi - x̄",
      title: "Horizontal deviations",
      explanation: "Horizontal deviation = how far this point's x-value is from the mean x-value.",
    },
    {
      id: "sd-x-squares",
      label: "(xi - x̄)²",
      title: "Squared horizontal deviations",
      explanation: "Squared horizontal deviation uses the horizontal distance as the side length of a square.",
    },
    {
      id: "sd-x-sum",
      label: "Σ(xi - x̄)²",
      title: "Total horizontal squared spread",
      explanation: "Shows all horizontal-deviation squares together as the accumulated squared horizontal spread.",
    },
    {
      id: "sd-x-average",
      label: "VAR_x",
      title: "Average horizontal squared deviation",
      explanation: "Shows the average squared horizontal deviation area after dividing the total by n.",
    },
    {
      id: "sd-x-length",
      label: "√VAR_x",
      title: "Horizontal standard deviation length",
      explanation: "√VAR converts the average squared deviation back into a normal distance from the mean.",
    },
  ],
  VAR: [
    {
      id: "variance-center",
      label: "(x̄, ȳ)",
      title: "Mean center",
      explanation: "Highlights the mean reference lines used to measure spread.",
    },
    {
      id: "variance-y-deviations",
      label: "yi - ȳ",
      title: "Vertical deviations",
      explanation: "Highlights each signed vertical displacement from the mean.",
    },
    {
      id: "variance-y-squares",
      label: "(yi - ȳ)²",
      title: "Squared vertical deviations",
      explanation: "Draws each vertical squared deviation as a literal area.",
    },
    {
      id: "variance-y-sum",
      label: "Σ(yi - ȳ)²",
      title: "Total vertical squared spread",
      explanation: "Shows the accumulated total of the vertical squared deviation areas.",
    },
    {
      id: "variance-y-average",
      label: "Σ(yi - ȳ)² / n",
      title: "Variance y area",
      explanation: "Shows the average vertical squared deviation as one representative area.",
    },
    {
      id: "variance-x-deviations",
      label: "xi - x̄",
      title: "Horizontal deviations",
      explanation: "Horizontal deviation = how far this point's x-value is from the mean x-value.",
    },
    {
      id: "variance-x-squares",
      label: "(xi - x̄)²",
      title: "Squared horizontal deviations",
      explanation: "Squared horizontal deviation uses the horizontal distance as the side length of a square.",
    },
    {
      id: "variance-x-sum",
      label: "Σ(xi - x̄)²",
      title: "Total horizontal squared spread",
      explanation: "Shows the accumulated total of the horizontal squared deviation areas.",
    },
    {
      id: "variance-x-average",
      label: "Σ(xi - x̄)² / n",
      title: "Variance x area",
      explanation: "Shows the average horizontal squared deviation as one representative area.",
    },
  ],
  COVAR: [
    {
      id: "covariance-means",
      label: "(x̄, ȳ)",
      title: "Mean center",
      explanation: "Highlights the horizontal and vertical mean lines.",
    },
    {
      id: "covariance-horizontal",
      label: "xi - x̄",
      title: "Horizontal deviations",
      explanation: "Highlights each horizontal displacement from the mean.",
    },
    {
      id: "covariance-vertical",
      label: "yi - ȳ",
      title: "Vertical deviations",
      explanation: "Highlights each vertical displacement from the mean.",
    },
    {
      id: "covariance-products",
      label: "(xi - x̄)(yi - ȳ)",
      title: "Comovement products",
      explanation: "Draws each horizontal-by-vertical product as a signed rectangle.",
    },
    {
      id: "covariance-average",
      label: "Σ(dx · dy) / n",
      title: "Average comovement",
      explanation: "Highlights all signed rectangles whose average is the covariance.",
    },
  ],
  MEDIAN: [
    {
      id: "median-point",
      label: "(median x, median y)",
      title: "Median point",
      explanation: "Highlights the point formed by the middle x and y values.",
    },
    {
      id: "median-x",
      label: "median x",
      title: "Horizontal median",
      explanation: "Highlights the vertical line at the middle x value.",
    },
    {
      id: "median-y",
      label: "median y",
      title: "Vertical median",
      explanation: "Highlights the horizontal line at the middle y value.",
    },
  ],
};
